/**
 * Browser port of `scripts/metadata/image_metadata.py`.
 *
 * Computes the two derived fields the static pipeline produces with
 * Pillow + imagehash + scikit-learn, using only a canvas:
 *   - `phash`     — 8×8 DCT perceptual hash (16 hex chars), the same shape the
 *                   duplicate-grouping sort reads (`hammingDistanceHex`).
 *   - `dominantColors` — three CIELAB triples (k-means over a 64px thumbnail),
 *                   ordered by cluster size, matching `paletteDistance` /
 *                   `colorSortKey` in `utils/sorting.ts`.
 *
 * Values need only be internally consistent within a Drive garden (every entry
 * is computed here), so exact parity with NumPy's DCT / KMeans isn't required —
 * the algorithms and output formats match.
 */

export interface ImageMetadata {
  phash: string;
  dominantColors: number[][];
}

const NUM_DOMINANT_COLORS = 3;
const PHASH_SIZE = 8; // low-frequency block edge → 64-bit hash
const PHASH_IMG = PHASH_SIZE * 4; // 32×32 pre-DCT image (imagehash highfreq_factor=4)

function drawTo(bitmap: ImageBitmap, w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ── Perceptual hash (DCT) ────────────────────────────────────────────────

/** 1-D DCT-II; the constant scale factor is dropped (irrelevant after the
 *  median threshold). */
function dct1d(vec: Float64Array): Float64Array {
  const N = vec.length;
  const out = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) sum += vec[n] * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N));
    out[k] = sum;
  }
  return out;
}

function computePhash(bitmap: ImageBitmap): string {
  const { data } = drawTo(bitmap, PHASH_IMG, PHASH_IMG);
  // Grayscale using PIL's "L" luma weights so this tracks imagehash.
  const gray: Float64Array[] = [];
  for (let y = 0; y < PHASH_IMG; y++) {
    const row = new Float64Array(PHASH_IMG);
    for (let x = 0; x < PHASH_IMG; x++) {
      const i = (y * PHASH_IMG + x) * 4;
      row[x] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    gray.push(row);
  }

  // 2-D DCT: transform rows, then columns.
  const rows = gray.map(dct1d);
  const dct: number[][] = Array.from({ length: PHASH_IMG }, () => new Array(PHASH_IMG).fill(0));
  const col = new Float64Array(PHASH_IMG);
  for (let x = 0; x < PHASH_IMG; x++) {
    for (let y = 0; y < PHASH_IMG; y++) col[y] = rows[y][x];
    const c = dct1d(col);
    for (let y = 0; y < PHASH_IMG; y++) dct[y][x] = c[y];
  }

  // Low-frequency 8×8 block, threshold against its median (imagehash includes
  // the DC term in the median, so we do too).
  const low: number[] = [];
  for (let y = 0; y < PHASH_SIZE; y++)
    for (let x = 0; x < PHASH_SIZE; x++) low.push(dct[y][x]);
  const sorted = [...low].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;

  // Pack row-major bits into 16 hex nibbles (matches imagehash's hex encoding).
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (low[nib * 4 + b] > median ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

// ── Dominant colors (k-means in CIELAB) ──────────────────────────────────

/** sRGB (0–255) → CIELAB, D65 white point (matches skimage.color.rgb2lab). */
function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  X /= 0.95047;
  Z /= 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Small deterministic PRNG so k-means++ seeding (and thus the output) is
// reproducible, standing in for the Python pipeline's fixed random_state.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(a: number[], b: number[]): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dL * dL + da * da + db * db;
}

function kmeans(points: number[][], k: number): number[][] {
  const rand = mulberry32(42);
  // k-means++ initialization.
  const centers: number[][] = [points[Math.floor(rand() * points.length)]];
  while (centers.length < k) {
    const d2 = points.map((p) => Math.min(...centers.map((c) => sqDist(p, c))));
    const total = d2.reduce((s, v) => s + v, 0);
    let target = rand() * total;
    let idx = 0;
    while (idx < d2.length - 1 && (target -= d2[idx]) > 0) idx++;
    centers.push(points[idx]);
  }

  const labels = new Array(points.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = sqDist(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    for (let c = 0; c < k; c++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < points.length; i++) {
        if (labels[i] !== c) continue;
        sum[0] += points[i][0];
        sum[1] += points[i][1];
        sum[2] += points[i][2];
        n++;
      }
      if (n > 0) centers[c] = [sum[0] / n, sum[1] / n, sum[2] / n];
    }
    if (!moved && iter > 0) break;
  }

  // Order clusters by descending membership, round to 1 decimal (as Python).
  const counts = new Array(k).fill(0);
  for (const l of labels) counts[l]++;
  return counts
    .map((count, c) => ({ count, center: centers[c] }))
    .sort((a, b) => b.count - a.count)
    .map(({ center }) => center.map((v) => Math.round(v * 10) / 10));
}

function computeDominantColors(bitmap: ImageBitmap): number[][] {
  const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const { data } = drawTo(bitmap, w, h);
  const points: number[][] = [];
  for (let i = 0; i < data.length; i += 4) {
    points.push(srgbToLab(data[i], data[i + 1], data[i + 2]));
  }
  return kmeans(points, NUM_DOMINANT_COLORS);
}

/** Compute `{ phash, dominantColors }` for an image blob (the resized JPEG). */
export async function computeImageMetadata(blob: Blob): Promise<ImageMetadata> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    return {
      phash: computePhash(bitmap),
      dominantColors: computeDominantColors(bitmap),
    };
  } finally {
    bitmap.close();
  }
}
