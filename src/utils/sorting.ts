import type { Plant } from "../types";

export type SortMode = "newest" | "oldest" | "color" | "similarity" | "duplicates";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  { value: "color", label: "COLOR" },
  { value: "similarity", label: "SIMILARITY" },
  { value: "duplicates", label: "DUPLICATES" },
];

export const SORT_DESCRIPTIONS: Record<SortMode, string> = {
  newest: "Most recently added first.",
  oldest: "Oldest entries first.",
  color: "Walks the gallery by dominant color in CIELAB space.",
  similarity: "Visual similarity via BioCLIP embeddings (plant-aware vision model).",
  duplicates: "Groups near-duplicate photos by perceptual hash (phash).",
};

export type EmbeddingMap = Record<string, number[]>;

interface EmbeddingFile {
  model_version: string;
  dim: number;
  embeddings: EmbeddingMap;
}

interface EmbeddingCacheEntry {
  data: EmbeddingMap | null;
  promise: Promise<EmbeddingMap> | null;
}

const embeddingCache: EmbeddingCacheEntry = { data: null, promise: null };

export async function loadEmbeddings(): Promise<EmbeddingMap> {
  if (embeddingCache.data) return embeddingCache.data;
  if (embeddingCache.promise) return embeddingCache.promise;

  const url = `${import.meta.env.BASE_URL}data/embeddings.json`;
  embeddingCache.promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load embeddings: ${res.status}`);
      return res.json();
    })
    .then((data: EmbeddingFile) => {
      embeddingCache.data = data.embeddings ?? {};
      return embeddingCache.data;
    })
    .catch((err) => {
      console.error(`Could not load embeddings:`, err);
      embeddingCache.promise = null;
      return {} as EmbeddingMap;
    });

  return embeddingCache.promise;
}

function labDistance(a: number[], b: number[]): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function hammingDistanceHex(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const na = parseInt(a[i] ?? "0", 16);
    const nb = parseInt(b[i] ?? "0", 16);
    let xor = na ^ nb;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return 1 - dot;
}

export function paletteDistance(
  a: number[][] | null,
  b: number[][] | null
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;
  const minLen = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < minLen; i++) sum += labDistance(a[i], b[i]);
  return sum / minLen;
}

function colorSortKey(plant: Plant): number {
  const colors = plant.dominantColors;
  if (!colors || colors.length === 0) return Infinity;
  const CHROMA_THRESHOLD = 8;
  for (const c of colors) {
    const [L, a, b] = c;
    const chroma = Math.sqrt(a * a + b * b);
    if (chroma >= CHROMA_THRESHOLD) {
      const hue = Math.atan2(b, a);
      const hueNorm = hue < 0 ? hue + 2 * Math.PI : hue;
      return hueNorm * 1000 + L;
    }
  }
  return 2 * Math.PI * 1000 + colors[0][0];
}

function nearestNeighborChain<T>(
  items: T[],
  distanceFn: (a: T, b: T) => number
): T[] {
  if (items.length <= 1) return [...items];
  const result: T[] = [items[0]];
  const used = new Set<number>([0]);

  for (let step = 1; step < items.length; step++) {
    const current = result[result.length - 1];
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      const dist = distanceFn(current, items[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      result.push(items[bestIdx]);
      used.add(bestIdx);
    }
  }
  return result;
}

function sortByEmbedding(plants: Plant[], embeddings: EmbeddingMap): Plant[] {
  const withEmb: Plant[] = [];
  const withoutEmb: Plant[] = [];
  for (const p of plants) {
    if (embeddings[p.id]) withEmb.push(p);
    else withoutEmb.push(p);
  }
  withoutEmb.sort(
    (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
  );
  if (withEmb.length <= 1) return [...withEmb, ...withoutEmb];
  const sorted = nearestNeighborChain(withEmb, (a, b) =>
    cosineDistance(embeddings[a.id], embeddings[b.id])
  );
  return [...sorted, ...withoutEmb];
}

export function sortPlants(plants: Plant[], mode: SortMode): Plant[] {
  const sorted = [...plants];

  switch (mode) {
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );
    case "duplicates": {
      if (sorted.length <= 1) return sorted;
      const withHash: Plant[] = [];
      const withoutHash: Plant[] = [];
      for (const p of sorted) {
        if (p.phash) withHash.push(p);
        else withoutHash.push(p);
      }
      withoutHash.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );
      if (withHash.length <= 1) return [...withHash, ...withoutHash];
      const result = nearestNeighborChain(withHash, (a, b) =>
        hammingDistanceHex(String(a.phash), String(b.phash))
      );
      return [...result, ...withoutHash];
    }
    case "color": {
      if (sorted.length <= 1) return sorted;
      sorted.sort((a, b) => {
        const ka = colorSortKey(a);
        const kb = colorSortKey(b);
        if (ka === Infinity && kb === Infinity) {
          return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
        }
        if (ka !== kb) return ka - kb;
        return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      });
      return sorted;
    }
    case "similarity":
      return sorted;
    default:
      return sorted;
  }
}

export async function sortPlantsAsync(
  plants: Plant[],
  mode: SortMode
): Promise<Plant[]> {
  if (mode !== "similarity") return sortPlants(plants, mode);
  const embeddings = await loadEmbeddings();
  return sortByEmbedding([...plants], embeddings);
}
