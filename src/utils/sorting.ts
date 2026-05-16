import type { Organism } from "../types";

export type SortMode = "newest" | "oldest" | "color" | "similarity" | "duplicates";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  { value: "color", label: "COLOR" },
  { value: "similarity", label: "Similarity (BioCLIP)" },
  // { value: "duplicates", label: "DUPLICATES" },
];

export const SORT_DESCRIPTIONS: Record<SortMode, string> = {
  newest: "Most recently added first.",
  oldest: "Oldest entries first.",
  color: "Walks the gallery by dominant color in CIELAB space.",
  similarity: "Visual similarity via BioCLIP embeddings (species-aware vision model).",
  duplicates: "Groups near-duplicate photos by perceptual hash (phash).",
};

export type EmbeddingMap = Record<string, number[]>;
export type PicMetadataMap = Record<string, { phash: string; dominantColors: number[][] }>;

interface EmbeddingFile {
  model_version: string;
  dim: number;
  embeddings: EmbeddingMap;
}

interface EmbeddingCacheEntry {
  data: EmbeddingMap | null;
  promise: Promise<EmbeddingMap> | null;
}

interface PicMetadataCacheEntry {
  data: PicMetadataMap | null;
  promise: Promise<PicMetadataMap> | null;
}

const embeddingCache: EmbeddingCacheEntry = { data: null, promise: null };
const picMetadataCache: PicMetadataCacheEntry = { data: null, promise: null };

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

export async function loadPicMetadata(): Promise<PicMetadataMap> {
  if (picMetadataCache.data) return picMetadataCache.data;
  if (picMetadataCache.promise) return picMetadataCache.promise;

  const url = `${import.meta.env.BASE_URL}data/pic-metadata.json`;
  picMetadataCache.promise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load pic-metadata: ${res.status}`);
      return res.json();
    })
    .then((data: { picMetadata?: { id: string; phash: string; dominantColors: number[][] }[] }) => {
      const map: PicMetadataMap = {};
      for (const m of data.picMetadata ?? []) map[m.id] = { phash: m.phash, dominantColors: m.dominantColors };
      picMetadataCache.data = map;
      return map;
    })
    .catch((err) => {
      console.error(`Could not load pic-metadata:`, err);
      picMetadataCache.promise = null;
      return {} as PicMetadataMap;
    });

  return picMetadataCache.promise;
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

function colorSortKey(colors: number[][] | undefined): number {
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

function sortByEmbedding(organisms: Organism[], embeddings: EmbeddingMap): Organism[] {
  const withEmb: Organism[] = [];
  const withoutEmb: Organism[] = [];
  for (const p of organisms) {
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

export function sortOrganisms(organisms: Organism[], mode: SortMode): Organism[] {
  const sorted = [...organisms];
  switch (mode) {
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );
    default:
      return sorted;
  }
}

export async function sortOrganismsAsync(
  organisms: Organism[],
  mode: SortMode
): Promise<Organism[]> {
  if (mode === "similarity") {
    const embeddings = await loadEmbeddings();
    return sortByEmbedding([...organisms], embeddings);
  }

  if (mode === "duplicates") {
    const meta = await loadPicMetadata();
    const sorted = [...organisms];
    if (sorted.length <= 1) return sorted;
    const withHash: Organism[] = [];
    const withoutHash: Organism[] = [];
    for (const p of sorted) {
      if (meta[p.id]?.phash) withHash.push(p);
      else withoutHash.push(p);
    }
    withoutHash.sort(
      (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    );
    if (withHash.length <= 1) return [...withHash, ...withoutHash];
    const result = nearestNeighborChain(withHash, (a, b) =>
      hammingDistanceHex(meta[a.id].phash, meta[b.id].phash)
    );
    return [...result, ...withoutHash];
  }

  if (mode === "color") {
    const meta = await loadPicMetadata();
    const sorted = [...organisms];
    if (sorted.length <= 1) return sorted;
    sorted.sort((a, b) => {
      const ka = colorSortKey(meta[a.id]?.dominantColors);
      const kb = colorSortKey(meta[b.id]?.dominantColors);
      if (ka === Infinity && kb === Infinity) {
        return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      }
      if (ka !== kb) return ka - kb;
      return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
    });
    return sorted;
  }

  return sortOrganisms(organisms, mode);
}
