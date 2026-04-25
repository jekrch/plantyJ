from pathlib import Path

import imagehash
import numpy as np
from PIL import Image
from skimage import color as skcolor
from sklearn.cluster import KMeans

NUM_DOMINANT_COLORS = 3

METADATA_FIELDS = {"width", "height", "phash", "dominantColors"}


def needs_update(plant: dict) -> bool:
    return any(plant.get(field) is None for field in METADATA_FIELDS)


def extract_dominant_colors(pixels_lab: np.ndarray, k: int = NUM_DOMINANT_COLORS) -> list:
    kmeans = KMeans(n_clusters=k, n_init=10, random_state=42)
    kmeans.fit(pixels_lab)
    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    order = np.argsort(-counts)
    centers = kmeans.cluster_centers_[order]
    return [[round(float(v), 1) for v in c] for c in centers]


def compute_metadata(image_path: Path) -> dict:
    img = Image.open(image_path)

    thumb = img.copy()
    thumb.thumbnail((64, 64))
    thumb = thumb.convert("RGB")

    pixels_rgb = np.array(thumb).reshape(-1, 3) / 255.0
    pixels_lab = skcolor.rgb2lab(pixels_rgb.reshape(1, -1, 3)).reshape(-1, 3)

    return {
        "width": img.width,
        "height": img.height,
        "phash": str(imagehash.phash(img)),
        "dominantColors": extract_dominant_colors(pixels_lab),
    }
