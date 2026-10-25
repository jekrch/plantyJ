"""Wikidata enrichment — links each species to its Wikidata item.

Wikidata has no general toxicity or edibility property for plants and animals
(P789 "edibility" covers mushrooms only), so no traits are extracted here.
"""
import re
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_WIKIDATA, ensure_reference, has_source, mark_source
from ..seed import save_species

WIKI_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_PORTAL = "https://www.wikidata.org/wiki/{id}"

def fetch_wikidata_id(title: str, health: IntegrationHealth) -> str | None:
    params = {
        "action": "wbgetentities",
        "sites": "enwiki",
        "titles": title.replace("_", " "),
        "props": "info",
        "format": "json",
    }
    try:
        resp = requests.get(
            WIKI_API,
            params=params,
            headers={"User-Agent": "plantyj/1.0 (https://github.com/jekrch/plantyJ)"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.Timeout:
        health.mark_throttled("request timed out")
        return None
    except Exception as e:
        print(f"  WARN: Wikidata fetch failed for {title}: {e}", file=sys.stderr)
        return None

    entities = data.get("entities", {})
    if "-1" in entities or not entities:
        return None

    # Get the first matching entity (Q-ID)
    return next(iter(entities))


def backfill_wikidata(species_entries: list[dict]) -> int:
    health = IntegrationHealth("Wikidata")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_WIKIDATA):
            continue

        full_name = entry.get("fullName")
        if not full_name:
            continue

        base_name = re.sub(r"\s*'[^']+'\s*$", "", full_name).strip()

        print(f"  Wikidata lookup: {base_name}")
        entity_id = fetch_wikidata_id(base_name, health)

        if entity_id:
            ensure_reference(
                entry,
                "Wikidata",
                WIKIDATA_PORTAL.format(id=entity_id),
            )

        mark_source(entry, SOURCE_WIKIDATA)
        save_species(entry)
        updated += 1
        time.sleep(0.5)

    return updated