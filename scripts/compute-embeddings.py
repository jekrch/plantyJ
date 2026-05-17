#!/usr/bin/env python3
"""
Compute BioCLIP image embeddings and extract species IDs for pics.json.

Uses `imageomics/bioclip` via OpenCLIP for embeddings, and `pybioclip` 
for Tree of Life taxonomic classifications.

Outputs: 
- public/data/embeddings.json
- public/data/pics.json (updated with species IDs)
"""
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image

# NEW: Import the official BioCLIP classifier
from bioclip import TreeOfLifeClassifier, Rank


@dataclass(frozen=True)
class ModelSpec:
    hf_name: str
    dim: int
    output_path: Path
    version: str


SPEC = ModelSpec(
    hf_name="hf-hub:imageomics/bioclip",
    dim=512,
    output_path=Path("public/data/embeddings.json"),
    version="bioclip-v1",
)

PICS_PATH = Path("public/data/pics.json")
IMAGE_ROOT = Path("public")


def load_existing(spec: ModelSpec) -> dict[str, list[float]]:
    if not spec.output_path.exists():
        return {}
        
    try:
        data = json.loads(spec.output_path.read_text())
    except json.JSONDecodeError:
        print(f"Warning: {spec.output_path} is empty or contains invalid JSON. Recomputing.")
        return {}
        
    if data.get("model_version") != spec.version:
        print(
            f"Version mismatch (stored={data.get('model_version')!r}, "
            f"expected={spec.version!r}). Recomputing all embeddings."
        )
        return {}
    return data.get("embeddings", {})


def save_embeddings(spec: ModelSpec, embeddings: dict[str, list[float]]) -> None:
    spec.output_path.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "model_version": spec.version,
        "dim": spec.dim,
        "embeddings": embeddings,
    }
    spec.output_path.write_text(json.dumps(output) + "\n")


def load_model(spec: ModelSpec):
    print(f"Loading OpenCLIP Model: {spec.hf_name}")
    model, _, preprocess = open_clip.create_model_and_transforms(spec.hf_name)
    model.eval()
    return model, preprocess


BATCH_SIZE = 16


def embed_batch(tensors: list[torch.Tensor], model) -> list[list[float]]:
    """Encode a stack of preprocessed image tensors in one forward pass.

    The BioCLIP ViT encoder is per-sample independent (LayerNorm, no
    BatchNorm, no cross-sample ops), so a batched forward yields the same
    per-image vectors as encoding one at a time.
    """
    batch = torch.stack(tensors)
    with torch.inference_mode():
        features = model.encode_image(batch)
        features = features / features.norm(dim=-1, keepdim=True)
    return [
        [round(float(v), 5) for v in row]
        for row in features.cpu().numpy()
    ]


def main():
    if not PICS_PATH.exists():
        print(f"pics.json not found at {PICS_PATH}", file=sys.stderr)
        sys.exit(1)

    # Safely load the entire JSON to avoid overwriting other root keys
    original_data = json.loads(PICS_PATH.read_text())
    pics = original_data.get("pics", [])
    existing = load_existing(SPEC)

    current_ids = {p["id"] for p in pics}
    pruned = {k: v for k, v in existing.items() if k in current_ids}
    pruned_count = len(existing) - len(pruned)
    if pruned_count:
        print(f"Pruned {pruned_count} stale embedding(s).")

    # Identify pictures missing an embedding OR missing the backfilled species ID
    to_compute = [
        p for p in pics 
        if p["id"] not in pruned or "bioclipSpeciesId" not in p
    ]
    
    if not to_compute:
        if pruned_count:
            save_embeddings(SPEC, pruned)
            print("Wrote pruned embeddings file.")
        else:
            print("All pics already have embeddings and predictions.")
        return

    print(f"Processing {len(to_compute)} pic(s) for missing embeddings or species IDs...")
    
    # Lazy load models depending on what work actually needs to be done
    needs_embedding = any(p["id"] not in pruned for p in to_compute)
    needs_classification = any("bioclipSpeciesId" not in p for p in to_compute)

    model, preprocess = None, None
    if needs_embedding:
        model, preprocess = load_model(SPEC)
    
    classifier = None
    if needs_classification:
        print("Loading TreeOfLife Classifier...")
        # device='cpu' is explicitly set to ensure stability on standard GH Action runners
        classifier = TreeOfLifeClassifier(device='cpu') 

    if needs_embedding:
        torch.set_num_threads(os.cpu_count() or 1)

    updated = dict(pruned)
    errors = 0
    embed_failed: set[str] = set()

    # Phase 1: embeddings, batched. Images are decoded/preprocessed one at a
    # time so a single corrupt file errors in isolation (same as before);
    # only the model forward is batched.
    if needs_embedding:
        pending: list[tuple[dict, torch.Tensor]] = []

        def flush() -> None:
            if not pending:
                return
            vecs = embed_batch([t for _, t in pending], model)
            for (p, _), vec in zip(pending, vecs):
                updated[p["id"]] = vec
                print(f"  EMB OK: {p['image']}")
            pending.clear()

        for pic in to_compute:
            if pic["id"] in pruned:
                continue  # embedding already present and kept
            image_path = IMAGE_ROOT / pic["image"]
            if not image_path.exists():
                continue  # reported in phase 2
            try:
                img = Image.open(image_path).convert("RGB")
                pending.append((pic, preprocess(img)))
            except Exception as e:
                print(f"  ERROR: {pic['image']} → {e}", file=sys.stderr)
                errors += 1
                embed_failed.add(pic["id"])
                continue
            if len(pending) >= BATCH_SIZE:
                flush()
        flush()

    # Phase 2: per-image species classification (pybioclip has no batch API).
    for i, pic in enumerate(to_compute, start=1):
        image_path = IMAGE_ROOT / pic["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {pic['image']}", file=sys.stderr)
            errors += 1
            continue
        if pic["id"] in embed_failed:
            continue  # embedding failed for this pic; skip classify (as before)

        try:
            # Extract Species Identification (only if missing)
            if "bioclipSpeciesId" not in pic:
                # predict() returns a list of dictionaries sorted by confidence
                preds = classifier.predict(str(image_path), Rank.SPECIES)
                if preds:
                    top_pred = preds[0]
                    pic["bioclipSpeciesId"] = top_pred.get("species", "")

                    # Optional but highly recommended context:
                    pic["bioclipCommonName"] = top_pred.get("common_name", "")
                    pic["bioclipScore"] = round(top_pred.get("score", 0.0), 4)

            print(f"  [{i}/{len(to_compute)}] OK: {pic['image']} -> {pic.get('bioclipSpeciesId')}")

        except Exception as e:
            print(f"  ERROR: {pic['image']} → {e}", file=sys.stderr)
            errors += 1

    # Save updated embeddings
    save_embeddings(SPEC, updated)
    
    # Save updated pics.json
    original_data["pics"] = pics
    PICS_PATH.write_text(json.dumps(original_data, indent=2) + "\n")
    print("Wrote updated species IDs to pics.json.")

    print(f"Done. {len(to_compute) - errors} processed, {errors} errors, {len(updated)} total embeddings.")


if __name__ == "__main__":
    main()