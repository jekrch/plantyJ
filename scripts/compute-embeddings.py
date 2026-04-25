#!/usr/bin/env python3
"""
Compute BioCLIP image embeddings for plants.json.

Uses `imageomics/bioclip` via OpenCLIP — a CLIP variant fine-tuned on the
Tree of Life dataset. It groups species, families, and visual plant
forms far better than generic vision models.

Output: public/data/embeddings.json
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image


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

PLANTS_PATH = Path("public/data/plants.json")
IMAGE_ROOT = Path("public")


def load_existing(spec: ModelSpec) -> dict[str, list[float]]:
    if not spec.output_path.exists():
        return {}
        
    try:
        # Catch errors if the file is empty or contains malformed JSON
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
    print(f"Loading BioCLIP: {spec.hf_name}")
    model, _, preprocess = open_clip.create_model_and_transforms(spec.hf_name)
    model.eval()
    return model, preprocess


def embed_image(image_path: Path, model, preprocess) -> list[float]:
    img = Image.open(image_path).convert("RGB")
    tensor = preprocess(img).unsqueeze(0)
    with torch.no_grad():
        features = model.encode_image(tensor)
        features = features / features.norm(dim=-1, keepdim=True)
    vec = features.squeeze(0).cpu().numpy()
    return [round(float(v), 5) for v in vec]


def main():
    if not PLANTS_PATH.exists():
        print(f"plants.json not found at {PLANTS_PATH}", file=sys.stderr)
        sys.exit(1)

    plants = json.loads(PLANTS_PATH.read_text()).get("plants", [])
    existing = load_existing(SPEC)

    current_ids = {p["id"] for p in plants}
    pruned = {k: v for k, v in existing.items() if k in current_ids}
    pruned_count = len(existing) - len(pruned)
    if pruned_count:
        print(f"Pruned {pruned_count} stale embedding(s).")

    to_compute = [p for p in plants if p["id"] not in pruned]
    if not to_compute:
        if pruned_count:
            save_embeddings(SPEC, pruned)
            print("Wrote pruned embeddings file.")
        else:
            print("All plants already have embeddings.")
        return

    print(f"Computing BioCLIP embeddings for {len(to_compute)} plant(s)...")
    model, preprocess = load_model(SPEC)

    updated = dict(pruned)
    errors = 0
    for i, plant in enumerate(to_compute, start=1):
        image_path = IMAGE_ROOT / plant["image"]
        if not image_path.exists():
            print(f"  SKIP (file not found): {plant['image']}", file=sys.stderr)
            errors += 1
            continue
        try:
            updated[plant["id"]] = embed_image(image_path, model, preprocess)
            print(f"  [{i}/{len(to_compute)}] OK: {plant['image']}")
        except Exception as e:
            print(f"  ERROR: {plant['image']} → {e}", file=sys.stderr)
            errors += 1

    save_embeddings(SPEC, updated)
    print(f"Done. {len(to_compute) - errors} new, {errors} errors, {len(updated)} total.")


if __name__ == "__main__":
    main()
