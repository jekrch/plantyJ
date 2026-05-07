#!/usr/bin/env python3
"""Quickly decide whether the metadata/embeddings pipeline has any work to do.

Stdlib-only so the workflow can run this before installing heavy deps. Writes
`needs_metadata`, `needs_embeddings`, and `any_work` to $GITHUB_OUTPUT and
prints a short summary to stdout.
"""
import json
import os
import re
import sys
from pathlib import Path

DATA = Path("public/data")


def load(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip())
    return slug.strip("-")


def main() -> int:
    pics_doc = load(DATA / "pics.json") or {}
    pics = pics_doc.get("pics", [])

    pic_meta_doc = load(DATA / "pic-metadata.json") or {}
    pic_meta_by_id = {m["id"]: m for m in pic_meta_doc.get("picMetadata", [])}

    emb_doc = load(DATA / "embeddings.json") or {}
    embeddings = emb_doc.get("embeddings", {})

    plants_doc = load(DATA / "plants.json") or {}
    plants = plants_doc.get("plants", [])

    species_doc = load(DATA / "species.json") or {}
    species = species_doc.get("species", {})

    needs_pic_metadata = any(
        p.get("width") is None
        or p.get("height") is None
        or pic_meta_by_id.get(p.get("id"), {}).get("phash") is None
        or pic_meta_by_id.get(p.get("id"), {}).get("dominantColors") is None
        for p in pics
    )

    needs_embeddings = any(
        p.get("id") not in embeddings or "bioclipSpeciesId" not in p
        for p in pics
    )

    # A freshly seeded species has an empty `sources` list. Once the backfill
    # has run, each source records itself there (even when no data was found),
    # so partial coverage of the known sources signals pending work. We don't
    # check taxonomy/description directly — hybrids legitimately end up with
    # empty fields after processing.
    known_sources = {"gbif", "powo", "wikipedia", "inaturalist", "wikidata", "natureserve"}
    needs_species_backfill = False
    for plant in plants:
        full_name = (plant.get("fullName") or "").strip()
        if not full_name:
            continue
        entry = species.get(slugify(full_name))
        if entry is None:
            needs_species_backfill = True
            break
        seen_sources = {
            s if isinstance(s, str) else s.get("id")
            for s in entry.get("sources", [])
        }
        if not known_sources.issubset(seen_sources):
            needs_species_backfill = True
            break

    needs_metadata = needs_pic_metadata or needs_species_backfill
    any_work = needs_metadata or needs_embeddings

    print(f"needs_pic_metadata={needs_pic_metadata}")
    print(f"needs_species_backfill={needs_species_backfill}")
    print(f"needs_metadata={needs_metadata}")
    print(f"needs_embeddings={needs_embeddings}")
    print(f"any_work={any_work}")

    out_path = os.environ.get("GITHUB_OUTPUT")
    if out_path:
        with open(out_path, "a") as f:
            f.write(f"needs_metadata={'true' if needs_metadata else 'false'}\n")
            f.write(f"needs_embeddings={'true' if needs_embeddings else 'false'}\n")
            f.write(f"any_work={'true' if any_work else 'false'}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
