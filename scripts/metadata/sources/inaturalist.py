"""iNaturalist enrichment — fetches local observation counts and native vernaculars."""
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_INATURALIST, ensure_reference, has_source, mark_source
from ..seed import save_species

INAT_API = "https://api.inaturalist.org/v1/taxa"
INAT_PORTAL = "https://www.inaturalist.org/taxa/{id}"


def fetch_inaturalist(full_name: str, health: IntegrationHealth) -> dict | None:
    try:
        resp = requests.get(
            INAT_API,
            # Place ID 38 prioritizes Upper Midwest vernacular names
            params={"q": full_name, "is_active": "true", "preferred_place_id": 38, "per_page": 1},
            headers={"User-Agent": "plantyj/1.0 (https://github.com/jekrch/plantyJ)"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 429:
            health.mark_throttled("rate limited (429)")
        print(f"  WARN: iNaturalist fetch failed for {full_name}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: iNaturalist fetch failed for {full_name}: {e}", file=sys.stderr)
        return None

    results = data.get("results", [])
    if not results:
        return None
    return results[0]


def backfill_inaturalist(species_entries: list[dict]) -> int:
    health = IntegrationHealth("iNaturalist")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_INATURALIST):
            continue

        full_name = entry.get("fullName")
        if not full_name:
            continue

        print(f"  iNaturalist lookup: {full_name}")
        match = fetch_inaturalist(full_name, health)
        
        if match:
            # We can store the observation count to indicate "popularity" or prevalence 
            entry["observationsCount"] = match.get("observations_count")
            
            preferred_common = match.get("preferred_common_name")
            if preferred_common:
                # Add it to vernaculars if it's not already the main common name
                if preferred_common.lower() != (entry.get("commonName") or "").lower():
                    vernaculars = entry.setdefault("vernacularNames", [])
                    if preferred_common not in vernaculars:
                        vernaculars.append(preferred_common)

            ensure_reference(
                entry,
                "iNaturalist",
                INAT_PORTAL.format(id=match["id"]),
            )

        mark_source(entry, SOURCE_INATURALIST)
        save_species(entry)
        updated += 1
        time.sleep(0.8) # iNat asks for ~1 request per second

    return updated