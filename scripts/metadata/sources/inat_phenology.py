"""iNaturalist phenology — monthly counts of observations annotated with a
life-cycle stage (flower buds, flowering, fruiting, leaf-out, fall color for
plants; life stage for animals).

Reuses the iNat taxon id stored by the iNaturalist pass, so it must run after
it. Counts come from Minnesota first, falling back to the whole US when the
local sample is too thin (the last place with any data wins). Fetched once
per species and never refreshed.
"""
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_INAT_PHENOLOGY, has_source, mark_source
from ..seed import save_species
from . import API_HEADERS

INAT_FIELD_VALUES = "https://api.inaturalist.org/v1/observations/popular_field_values"

# (place_id, display name), tried in order. Global is deliberately excluded:
# Southern Hemisphere observations would shift every month by half a year.
PLACES = [(38, "Minnesota"), (1, "United States")]

# Minimum total annotated observations before a place's counts are trusted.
MIN_OBSERVATIONS = 20

# (controlled_attribute_id, controlled_value_id) -> (stage id, label), in
# display order. Ids come from https://api.inaturalist.org/v1/controlled_terms.
STAGES = {
    (12, 15): ("budding", "Flower buds"),
    (12, 13): ("flowering", "Flowering"),
    (12, 14): ("fruiting", "Fruits & seeds"),
    (36, 37): ("leafOut", "Leaf-out"),
    (36, 39): ("fallColor", "Fall color"),
    (1, 7): ("egg", "Egg"),
    (1, 6): ("larva", "Larva"),
    (1, 5): ("nymph", "Nymph"),
    (1, 4): ("pupa", "Pupa"),
    (1, 8): ("juvenile", "Juvenile"),
    (1, 2): ("adult", "Adult"),
}
STAGE_ORDER = [stage for stage, _ in STAGES.values()]


def inat_taxon_id(entry: dict) -> str | None:
    for ref in entry.get("references", []):
        if ref.get("name") == "iNaturalist":
            return (ref.get("url") or "").rstrip("/").rsplit("/", 1)[-1] or None
    return None


def fetch_stages(taxon_id: str, place_id: int, health: IntegrationHealth) -> list[dict] | None:
    """Return the known stages with their 12 monthly counts, or None on error."""
    try:
        resp = requests.get(
            INAT_FIELD_VALUES,
            params={"taxon_id": taxon_id, "place_id": place_id, "verifiable": "true"},
            headers=API_HEADERS,
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
        print(f"  WARN: iNat phenology failed for taxon {taxon_id}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: iNat phenology failed for taxon {taxon_id}: {e}", file=sys.stderr)
        return None

    stages = []
    for r in data.get("results", []):
        key = (
            (r.get("controlled_attribute") or {}).get("id"),
            (r.get("controlled_value") or {}).get("id"),
        )
        if key not in STAGES:
            continue
        by_month = r.get("month_of_year") or {}
        months = [int(by_month.get(str(m), 0) or 0) for m in range(1, 13)]
        if not any(months):
            continue
        stage, label = STAGES[key]
        stages.append({"stage": stage, "label": label, "months": months})
    stages.sort(key=lambda s: STAGE_ORDER.index(s["stage"]))
    return stages


def backfill_inat_phenology(species_entries: list[dict]) -> int:
    health = IntegrationHealth("iNat phenology")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_INAT_PHENOLOGY):
            continue

        taxon_id = inat_taxon_id(entry)
        if not taxon_id:
            mark_source(entry, SOURCE_INAT_PHENOLOGY)
            save_species(entry)
            continue

        print(f"  iNat phenology lookup: {entry.get('fullName')}")
        phenology = None
        failed = False
        for place_id, place_name in PLACES:
            stages = fetch_stages(taxon_id, place_id, health)
            time.sleep(1.0)  # iNat asks for ~1 request per second
            if stages is None:
                failed = True
                break
            if stages:
                phenology = {"place": place_name, "stages": stages}
            if sum(sum(s["months"]) for s in stages) >= MIN_OBSERVATIONS:
                break

        # Leave a failed lookup unmarked so the next run retries it.
        if failed:
            continue

        entry["phenology"] = phenology
        mark_source(entry, SOURCE_INAT_PHENOLOGY)
        save_species(entry)
        updated += 1

    return updated
