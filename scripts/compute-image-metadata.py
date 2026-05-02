#!/usr/bin/env python3
"""
Compute per-image metadata for pics.json and refresh per-species
enrichment files in public/data/species/.

For images: dimensions, perceptual hash, and dominant CIELAB colors.
For species: GBIF taxonomy + vernacular names, POWO native range,
Wikipedia description, iNaturalist observation counts, Wikidata 
traits (edibility/toxicity), and IUCN Red List conservation status.

Each enrichment source is best-effort — failures and rate limits are
caught so a third-party hiccup doesn't fail the build.
"""
import json
import sys

from metadata.image_metadata import compute_metadata, needs_update
from metadata.paths import IMAGE_ROOT, PIC_METADATA_PATH, PICS_PATH, PLANTS_PATH, SPECIES_DIR
from metadata.seed import seed_species
from metadata.sources.gbif import backfill_gbif
from metadata.sources.powo import backfill_powo
from metadata.sources.wikipedia import backfill_wikipedia
from metadata.sources.inaturalist import backfill_inaturalist
from metadata.sources.wikidata import backfill_wikidata
from metadata.sources.natureserve import backfill_natureserve
from metadata.sources.taxonomy_wiki import build_taxa_registry


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


def flag_animal_pics(pics: list[dict], plants: list[dict], species_entries: list[dict]) -> int:
    """Set kind='animal' on pics whose species taxonomy has kingdom='Animalia'."""
    full_name_to_short_code = {
        p["fullName"].lower(): p["shortCode"]
        for p in plants
        if p.get("fullName")
    }

    animal_short_codes = set()
    for entry in species_entries:
        taxonomy = entry.get("taxonomy") or {}
        if taxonomy.get("kingdom") == "Animalia":
            full_name = entry.get("fullName", "")
            short_code = full_name_to_short_code.get(full_name.lower())
            if short_code:
                animal_short_codes.add(short_code)

    flagged = 0
    for pic in pics:
        if pic.get("shortCode") in animal_short_codes and pic.get("kind") != "animal":
            pic["kind"] = "animal"
            flagged += 1

    return flagged


def main():
    if not PICS_PATH.exists():
        print(f"pics.json not found at {PICS_PATH}", file=sys.stderr)
        sys.exit(1)
    if not PLANTS_PATH.exists():
        print(f"plants.json not found at {PLANTS_PATH}", file=sys.stderr)
        sys.exit(1)

    pics_doc = json.loads(PICS_PATH.read_text())
    pics = pics_doc.get("pics", [])

    plants_doc = json.loads(PLANTS_PATH.read_text())
    plants = plants_doc.get("plants", [])

    pic_meta_doc = json.loads(PIC_METADATA_PATH.read_text()) if PIC_METADATA_PATH.exists() else {"picMetadata": []}
    pic_meta_by_id: dict[str, dict] = {m["id"]: m for m in pic_meta_doc.get("picMetadata", [])}

    seed_species(plants)
    species_entries = load_species_entries()

    animal_flagged = 0

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

        print("Building normalized Taxa registry...")
        taxa_added = build_taxa_registry(species_entries)
        print(f"  Added {taxa_added} new taxa to taxa.json.")

        print("Backfilling iNaturalist data...")
        inat_count = backfill_inaturalist(species_entries)
        print(f"  iNaturalist processed {inat_count} entries.")

        print("Backfilling Wikidata traits...")
        wikidata_count = backfill_wikidata(species_entries)
        print(f"  Wikidata processed {wikidata_count} entries.")

        print("Backfilling NatureServe status...")
        natureserve_count = backfill_natureserve(species_entries)
        print(f"  NatureServe processed {natureserve_count} entries.")

        animal_flagged = flag_animal_pics(pics, plants, species_entries)
        if animal_flagged:
            print(f"  Flagged {animal_flagged} pic(s) as animal based on taxonomy.")

    updated = 0
    errors = 0

    for pic in pics:
        meta_entry = pic_meta_by_id.get(pic["id"])
        if not needs_update(pic, meta_entry):
            continue

        image_path = IMAGE_ROOT / pic["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {pic['image']}", file=sys.stderr)
            errors += 1
            continue

        try:
            computed = compute_metadata(image_path)
            pic["width"] = computed["width"]
            pic["height"] = computed["height"]
            if meta_entry is None:
                meta_entry = {"id": pic["id"]}
                pic_meta_by_id[pic["id"]] = meta_entry
            meta_entry["phash"] = computed["phash"]
            meta_entry["dominantColors"] = computed["dominantColors"]
            updated += 1
            print(
                f"  OK: {pic['image']} → {computed['width']}x{computed['height']} "
                f"phash={computed['phash']}"
            )
        except Exception as e:
            print(f"  ERROR: {pic['image']} → {e}", file=sys.stderr)
            errors += 1

    if updated or animal_flagged:
        PICS_PATH.write_text(json.dumps(pics_doc, indent=2) + "\n")
        pic_meta_doc["picMetadata"] = list(pic_meta_by_id.values())
        PIC_METADATA_PATH.write_text(json.dumps(pic_meta_doc, indent=2) + "\n")
        print(f"\nUpdated {updated} pic(s). Errors: {errors}.")
    else:
        print("\nNo pic images needed updating.")


if __name__ == "__main__":
    main()