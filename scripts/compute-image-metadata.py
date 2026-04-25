#!/usr/bin/env python3
"""
Compute per-image metadata for plants.json and refresh per-species
enrichment files in public/data/species/.

For images: dimensions, perceptual hash, and dominant CIELAB colors.
For species: GBIF taxonomy + vernacular names, POWO native range,
Wikipedia description (lead section).

Each enrichment source is best-effort — failures and rate limits are
caught so a third-party hiccup doesn't fail the build.
"""
import json
import sys

from metadata.image_metadata import compute_metadata, needs_update
from metadata.paths import IMAGE_ROOT, PLANTS_PATH, SPECIES_DIR
from metadata.seed import seed_species
from metadata.sources.gbif import backfill_gbif
from metadata.sources.powo import backfill_powo
from metadata.sources.wikipedia import backfill_wikipedia


def load_species_entries() -> list[dict]:
    if not SPECIES_DIR.exists():
        return []
    entries = []
    for path in sorted(SPECIES_DIR.glob("*.json")):
        try:
            entries.append(json.loads(path.read_text()))
        except Exception as e:
            print(f"  WARN: failed to parse {path}: {e}", file=sys.stderr)
    return entries


def main():
    if not PLANTS_PATH.exists():
        print(f"plants.json not found at {PLANTS_PATH}", file=sys.stderr)
        sys.exit(1)

    gallery = json.loads(PLANTS_PATH.read_text())
    plants = gallery.get("plants", [])

    seed_species(plants)
    species_entries = load_species_entries()

    if species_entries:
        print("Backfilling species data from GBIF...")
        gbif_count = backfill_gbif(species_entries)
        print(f"  GBIF processed {gbif_count} entries.")

        print("Backfilling species data from POWO...")
        powo_count = backfill_powo(species_entries)
        print(f"  POWO processed {powo_count} entries.")

        print("Backfilling Wikipedia descriptions...")
        wiki_count = backfill_wikipedia(species_entries)
        print(f"  Wikipedia processed {wiki_count} entries.")

    updated = 0
    errors = 0

    for plant in plants:
        if not needs_update(plant):
            continue

        image_path = IMAGE_ROOT / plant["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {plant['image']}", file=sys.stderr)
            errors += 1
            continue

        try:
            meta = compute_metadata(image_path)
            plant.update(meta)
            updated += 1
            print(
                f"  OK: {plant['image']} → {meta['width']}x{meta['height']} "
                f"phash={meta['phash']}"
            )
        except Exception as e:
            print(f"  ERROR: {plant['image']} → {e}", file=sys.stderr)
            errors += 1

    if updated:
        PLANTS_PATH.write_text(json.dumps(gallery, indent=2) + "\n")
        print(f"\nUpdated {updated} plant(s). Errors: {errors}.")
    else:
        print("\nNo plant images needed updating.")


if __name__ == "__main__":
    main()
