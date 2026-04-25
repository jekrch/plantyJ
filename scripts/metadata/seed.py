"""
Build/refresh per-species enrichment files keyed on `fullName`.

For each unique `fullName` in `plants.json`, ensure a file at
`public/data/species/{slug}.json` exists. New files are seeded with the
identifying name and an empty references/sources list, leaving the
description/taxonomy fields blank for the GBIF/POWO/Wikipedia passes to fill in.
"""
import json

from .paths import SPECIES_DIR
from .text import slugify


def species_path(full_name: str):
    SPECIES_DIR.mkdir(parents=True, exist_ok=True)
    return SPECIES_DIR / f"{slugify(full_name)}.json"


def load_species(full_name: str) -> dict | None:
    path = species_path(full_name)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def save_species(entry: dict) -> None:
    path = species_path(entry["fullName"])
    path.write_text(json.dumps(entry, indent=2) + "\n")


def seed_species(plants: list) -> None:
    """Ensure a species file exists for each distinct fullName in the gallery."""
    SPECIES_DIR.mkdir(parents=True, exist_ok=True)

    seen = set()
    added = 0
    for plant in plants:
        full_name = (plant.get("fullName") or "").strip()
        if not full_name or full_name in seen:
            continue
        seen.add(full_name)

        path = species_path(full_name)
        if path.exists():
            continue

        entry = {
            "id": slugify(full_name),
            "fullName": full_name,
            "commonName": plant.get("commonName"),
            "description": "",
            "vernacularNames": [],
            "taxonomy": None,
            "nativeRange": None,
            "references": [],
            "sources": [],
        }
        save_species(entry)
        added += 1

    if added:
        print(f"Seeded {added} new species file(s) in {SPECIES_DIR}.")
