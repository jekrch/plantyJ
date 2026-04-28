"""NatureServe enrichment — fetches North American conservation status."""
import sys
import time
import re
import requests

from ..health import IntegrationHealth
from ..references import SOURCE_NATURESERVE, ensure_reference, has_source, mark_source
from ..seed import save_species

NS_SEARCH = "https://explorer.natureserve.org/api/data/speciesSearch"
NS_PORTAL = "https://explorer.natureserve.org/Taxon/{uid}"

# NatureServe Global Ranks (G-Ranks)
RANK_MAP = {
    "G1": "Critically Imperiled",
    "G2": "Imperiled",
    "G3": "Vulnerable",
    "G4": "Apparently Secure",
    "G5": "Secure",
    "GH": "Possibly Extinct",
    "GX": "Presumed Extinct"
}

def fetch_natureserve_status(full_name: str, health: IntegrationHealth) -> dict | None:
    payload = {
        "criteriaType": "species",
        "textCriteria": [{"paramType": "quickSearch", "searchToken": full_name}]
    }
    try:
        resp = requests.post(
            NS_SEARCH,
            json=payload,
            headers={"User-Agent": "plantyj/1.0 (https://github.com/jekrch/plantyJ)"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except Exception as e:
        print(f"  WARN: NatureServe fetch failed for {full_name}: {e}", file=sys.stderr)
        return None

    results = data.get("results", [])
    if not results:
        return None
        
    return results[0]

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
        match = fetch_natureserve_status(base_name, health)
        
        if match:
            # Extract the core rank (e.g., "G5" from "G5T4" or "G5?")
            raw_rank = match.get("roundedGlobalRankcode", "")
            base_rank = raw_rank[:2] if len(raw_rank) >= 2 else None
            
            if base_rank in RANK_MAP:
                entry["conservationStatus"] = RANK_MAP[base_rank]

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