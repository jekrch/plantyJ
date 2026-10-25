"""NatureServe enrichment — fetches global and Minnesota conservation status."""
import sys
import time
import re
import requests

from ..health import IntegrationHealth
from ..references import SOURCE_NATURESERVE, ensure_reference, has_source, mark_source
from ..seed import save_species
from . import API_HEADERS

NS_SEARCH = "https://explorer.natureserve.org/api/data/speciesSearch"
NS_PORTAL = "https://explorer.natureserve.org/Taxon/{uid}"

# The garden is in Minneapolis, so the state (subnational) rank is the one
# that says whether a species is locally rare, native, or introduced.
STATE_NATION = "US"
STATE_CODE = "MN"

# Rounded rank suffix -> label. The same scale is used for global (G),
# infraspecific (T), and subnational (S) ranks, e.g. G5 / T4 / S3 / SNA.
RANK_LABELS = {
    "1": "Critically Imperiled",
    "2": "Imperiled",
    "3": "Vulnerable",
    "4": "Apparently Secure",
    "5": "Secure",
    "H": "Possibly Extirpated",
    "X": "Presumed Extirpated",
    "U": "Unrankable",
    "NR": "Unranked",
    "NA": "Not Applicable",
}

# Trailing qualifiers are ignored: migratory animals get seasonal ranks
# like "S5B" (breeding population).
RANK_RE = re.compile(r"^([GTS])(NR|NA|[1-5HXU])")


def rank_label(rank: str | None) -> str | None:
    m = RANK_RE.match(rank or "")
    if not m:
        return None
    label = RANK_LABELS[m.group(2)]
    # Global extirpation means the taxon is gone everywhere.
    if m.group(1) != "S":
        label = label.replace("Extirpated", "Extinct")
    return label


def search_natureserve(name: str, health: IntegrationHealth) -> list[dict] | None:
    payload = {
        "criteriaType": "species",
        "textCriteria": [{"paramType": "quickSearch", "searchToken": name}]
    }
    try:
        resp = requests.post(
            NS_SEARCH,
            json=payload,
            headers=API_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except Exception as e:
        print(f"  WARN: NatureServe fetch failed for {name}: {e}", file=sys.stderr)
        return None

    return data.get("results", [])


def exact_match(results: list[dict], name: str) -> dict | None:
    wanted = name.lower()
    for result in results:
        if (result.get("scientificName") or "").strip().lower() == wanted:
            return result
    return None


def find_match(entry: dict, base_name: str, health: IntegrationHealth) -> dict | None:
    """Find the NatureServe record for a species.

    Quick search is fuzzy: alongside exact hits it returns subspecies and
    unrelated near-names (Humulus lupulus -> a crayfish, Creaserinus
    limulus), so a result is only trusted when its name matches exactly.
    After the name as written, GBIF's accepted species name is tried, which
    covers typos, cultivars, and forms. Last, a lone result sharing the
    species epithet is taken as NatureServe resolving a synonym (Hepatica
    acutiloba -> Anemone acutiloba).
    """
    results = search_natureserve(base_name, health)
    if results is None:
        return None
    match = exact_match(results, base_name)
    if match:
        return match

    accepted = ((entry.get("taxonomy") or {}).get("species") or "").strip()
    if accepted and accepted.lower() != base_name.lower():
        time.sleep(0.5)
        accepted_results = search_natureserve(accepted, health)
        match = exact_match(accepted_results or [], accepted)
        if match:
            return match

    parts = base_name.lower().split()
    if len(parts) == 2:
        epithet = parts[1]
        hits = [
            r for r in results
            if epithet in (r.get("scientificName") or "").lower().split()
        ]
        if len(hits) == 1:
            return hits[0]
    return None


def build_conservation(match: dict) -> dict | None:
    global_rank = match.get("roundedGRank")
    state = None
    for nation in match.get("nations") or []:
        if nation.get("nationCode") != STATE_NATION:
            continue
        for sub in nation.get("subnations") or []:
            if sub.get("subnationCode") == STATE_CODE:
                rank = sub.get("roundedSRank")
                state = {
                    "code": STATE_CODE,
                    "rank": rank,
                    "label": rank_label(rank),
                    "native": bool(sub.get("native")),
                    "exotic": bool(sub.get("exotic")),
                }
    if not global_rank and not state:
        return None
    return {
        "globalRank": global_rank,
        "globalLabel": rank_label(global_rank),
        "state": state,
    }


def backfill_natureserve(species_entries: list[dict]) -> int:
    health = IntegrationHealth("NatureServe")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_NATURESERVE):
            continue

        full_name = entry.get("fullName")
        if not full_name:
            continue

        base_name = re.sub(r"\s*'[^']+'\s*$", "", full_name).strip()

        print(f"  NatureServe lookup: {base_name}")
        match = find_match(entry, base_name, health)
        if match is None and health.should_bail:
            break

        if match:
            conservation = build_conservation(match)
            if conservation:
                entry["conservation"] = conservation

            uid = match.get("uniqueId")
            if uid:
                ensure_reference(
                    entry,
                    "NatureServe Explorer",
                    NS_PORTAL.format(uid=uid),
                )

        mark_source(entry, SOURCE_NATURESERVE)
        save_species(entry)
        updated += 1
        time.sleep(0.5)

    return updated
