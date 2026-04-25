"""POWO (Kew Plants of the World Online) enrichment fallback.

Used when GBIF doesn't return a usable taxonomy or native range.
POWO has no public REST contract, so this hits its undocumented JSON
search endpoint and is best-effort. Failures are silently swallowed.
"""
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_POWO, ensure_reference, has_source, mark_source
from ..seed import save_species

POWO_SEARCH = "https://powo.science.kew.org/api/2/search"
POWO_TAXON = "https://powo.science.kew.org/api/2/taxon/{fqid}"
POWO_PORTAL = "https://powo.science.kew.org/taxon/{fqid}"


def fetch_powo(full_name: str, health: IntegrationHealth) -> dict | None:
    try:
        resp = requests.get(
            POWO_SEARCH,
            params={"q": full_name, "perPage": 5},
            headers={"User-Agent": "plantyj/1.0"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except Exception as e:
        print(f"  WARN: POWO search failed for {full_name}: {e}", file=sys.stderr)
        return None

    results = data.get("results", []) or []
    if not results:
        return None
    accepted = next((r for r in results if r.get("accepted")), results[0])
    fqid = accepted.get("fqId")
    if not fqid:
        return None

    try:
        detail = requests.get(
            POWO_TAXON.format(fqid=fqid),
            headers={"User-Agent": "plantyj/1.0"},
            timeout=10,
        )
        detail.raise_for_status()
        return {**accepted, **detail.json()}
    except Exception:
        return accepted


def backfill_powo(species_entries: list[dict]) -> int:
    health = IntegrationHealth("POWO")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_POWO):
            continue
        if entry.get("nativeRange"):
            mark_source(entry, SOURCE_POWO)
            save_species(entry)
            continue

        full_name = entry.get("fullName")
        if not full_name:
            continue

        print(f"  POWO lookup: {full_name}")
        match = fetch_powo(full_name, health)
        if match:
            distribution = match.get("distribution") or {}
            natives = distribution.get("natives") or []
            if natives:
                entry["nativeRange"] = [n.get("name") for n in natives if n.get("name")]
            fqid = match.get("fqId")
            if fqid:
                ensure_reference(entry, "POWO", POWO_PORTAL.format(fqid=fqid))

        mark_source(entry, SOURCE_POWO)
        save_species(entry)
        updated += 1
        time.sleep(0.3)

    return updated
