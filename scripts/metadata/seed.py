"""
Build/refresh species enrichment records keyed by `fullName`, stored as a single
bundle at `public/data/species.json` ({"species": {slug: entry}}).

For each plant in `plants.json`, ensure an entry exists in the bundle. New
entries are seeded with the identifying name and empty references/sources,
leaving description/taxonomy fields blank for the GBIF/POWO/Wikipedia passes
to fill in.
"""
import json

from .paths import SPECIES_BUNDLE_PATH
from .text import slugify


# In-process cache of the species bundle. Every backfill source calls
# save_species() once per entry; without this each call re-read and
# re-parsed the entire species.json (N entries x 6 sources). This module
# is the only in-process writer, so the cache stays consistent and the
# on-disk file after each call is byte-identical to before.
_bundle_cache: dict[str, dict] | None = None


def load_species_bundle() -> dict[str, dict]:
    global _bundle_cache
    if _bundle_cache is not None:
        return _bundle_cache
    if not SPECIES_BUNDLE_PATH.exists():
        _bundle_cache = {}
        return _bundle_cache
    doc = json.loads(SPECIES_BUNDLE_PATH.read_text())
    _bundle_cache = doc.get("species", {})
    return _bundle_cache


def write_species_bundle(bundle: dict[str, dict]) -> None:
    global _bundle_cache
    SPECIES_BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    sorted_bundle = {k: bundle[k] for k in sorted(bundle)}
    SPECIES_BUNDLE_PATH.write_text(
        json.dumps({"species": sorted_bundle}, indent=2) + "\n"
    )
    _bundle_cache = bundle


def load_species(full_name: str) -> dict | None:
    return load_species_bundle().get(slugify(full_name))


def save_species(entry: dict) -> None:
    bundle = load_species_bundle()
    bundle[slugify(entry["fullName"])] = entry
    write_species_bundle(bundle)


def seed_species(plants: list) -> None:
    """Ensure a bundle entry exists for each distinct fullName in plants.json."""
    bundle = load_species_bundle()

    seen = set()
    added = 0
    for plant in plants:
        full_name = (plant.get("fullName") or "").strip()
        if not full_name or full_name in seen:
            continue
        seen.add(full_name)

        slug = slugify(full_name)
        if slug in bundle:
            continue

        bundle[slug] = {
            "id": slug,
            "fullName": full_name,
            "commonName": plant.get("commonName"),
            "description": "",
            "vernacularNames": [],
            "taxonomy": None,
            "nativeRange": None,
            "references": [],
            "sources": [],
        }
        added += 1

    if added:
        write_species_bundle(bundle)
        print(f"Seeded {added} new species in {SPECIES_BUNDLE_PATH}.")
