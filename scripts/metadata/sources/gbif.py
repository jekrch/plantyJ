"""GBIF Species API enrichment.

Looks up each species by `fullName`, fills canonical taxonomy and
vernacular names. Free, no key required.
"""
import sys
import time

import requests

from ..health import IntegrationHealth
from ..references import SOURCE_GBIF, ensure_reference, has_source, mark_source
from ..seed import save_species

GBIF_MATCH = "https://api.gbif.org/v1/species/match"
GBIF_VERNACULAR = "https://api.gbif.org/v1/species/{key}/vernacularNames"
GBIF_PORTAL = "https://www.gbif.org/species/{key}"


def fetch_gbif(full_name: str, health: IntegrationHealth) -> dict | None:
    try:
        resp = requests.get(
            GBIF_MATCH,
            params={"name": full_name, "verbose": "true"},
            headers={"User-Agent": "plantyj/1.0"},
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
        print(f"  WARN: GBIF match failed for {full_name}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  WARN: GBIF match failed for {full_name}: {e}", file=sys.stderr)
        return None

    if data.get("matchType") in (None, "NONE"):
        return None
    return data


def fetch_vernacular(species_key: int, health: IntegrationHealth) -> list[str]:
    try:
        resp = requests.get(
            GBIF_VERNACULAR.format(key=species_key),
            params={"limit": 50},
            headers={"User-Agent": "plantyj/1.0"},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except requests.exceptions.Timeout:
        health.mark_throttled("vernacular timed out")
        return []
    except Exception as e:
        print(f"  WARN: GBIF vernacular failed: {e}", file=sys.stderr)
        return []

    names = []
    seen = set()
    for r in results:
        if r.get("language") and r["language"].lower() != "eng":
            continue
        name = r.get("vernacularName", "").strip()
        key = name.lower()
        if name and key not in seen:
            seen.add(key)
            names.append(name)
    return names


def backfill_gbif(species_entries: list[dict]) -> int:
    health = IntegrationHealth("GBIF")
    updated = 0

    for entry in species_entries:
        if health.should_bail:
            break
        if has_source(entry, SOURCE_GBIF):
            continue
        full_name = entry.get("fullName")
        if not full_name:
            continue

        print(f"  GBIF lookup: {full_name}")
        match = fetch_gbif(full_name, health)
        if match and match.get("usageKey"):
            entry["taxonomy"] = {
                "kingdom": match.get("kingdom"),
                "phylum": match.get("phylum"),
                "class": match.get("class"),
                "order": match.get("order"),
                "family": match.get("family"),
                "genus": match.get("genus"),
                "species": match.get("species"),
                "canonicalName": match.get("canonicalName"),
            }
            ensure_reference(
                entry,
                "GBIF",
                GBIF_PORTAL.format(key=match["usageKey"]),
            )
            vernacular = fetch_vernacular(match["usageKey"], health)
            if vernacular:
                entry["vernacularNames"] = vernacular

        mark_source(entry, SOURCE_GBIF)
        save_species(entry)
        updated += 1
        time.sleep(0.3)

    return updated
