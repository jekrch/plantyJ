"""Wikidata enrichment — extracts semantic traits like toxicity and edibility."""
import re
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_WIKIDATA, ensure_reference, has_source, mark_source
from ..seed import save_species

WIKI_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_PORTAL = "https://www.wikidata.org/wiki/{id}"

# P4881 = toxicity, P3064 = edible parts, P225 = taxon name
TRAIT_PROPERTIES = {"P4881", "P3064"} 


def fetch_wikidata_traits(title: str, health: IntegrationHealth) -> dict | None:
    params = {
        "action": "wbgetentities",
        "sites": "enwiki",
        "titles": title.replace("_", " "),
        "props": "claims",
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
    entity_id = next(iter(entities))
    claims = entities[entity_id].get("claims", {})
    
    return {
        "id": entity_id,
        "isToxic": "P4881" in claims,
        "isEdible": "P3064" in claims
    }


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
        traits = fetch_wikidata_traits(base_name, health)
        
        if traits:
            # We only record these if they are definitively true in the DB
            if traits.get("isToxic"):
                entry["toxic"] = True
            if traits.get("isEdible"):
                entry["edible"] = True

            ensure_reference(
                entry,
                "Wikidata",
                WIKIDATA_PORTAL.format(id=traits["id"]),
            )

        mark_source(entry, SOURCE_WIKIDATA)
        save_species(entry)
        updated += 1
        time.sleep(0.5)

    return updated