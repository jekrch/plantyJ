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
      for (const m of data.picMetadata ?? [])
        map[m.id] = { phash: m.phash, dominantColors: m.dominantColors };
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

export function paletteDistance(a: number[][] | null, b: number[][] | null): number {
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

function nearestNeighborChain<T>(items: T[], distanceFn: (a: T, b: T) => number): T[] {
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
  withoutEmb.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
  if (withEmb.length <= 1) return [...withEmb, ...withoutEmb];
  const sorted = nearestNeighborChain(withEmb, (a, b) =>
    cosineDistance(embeddings[a.id], embeddings[b.id]),
  );
  return [...sorted, ...withoutEmb];
}

export function sortOrganisms(organisms: Organism[], mode: SortMode): Organism[] {
  const sorted = [...organisms];
  switch (mode) {
    case "newest":
      return sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
    case "oldest":
      return sorted.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
    default:
      return sorted;
  }
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The image's own timestamp (Unix seconds embedded in its id / filename),
 * falling back to `addedAt` when no timestamp can be parsed.
 */
export function imageTime(organism: Organism): number {
  const fromId = /-(\d{9,})$/.exec(organism.id);
  if (fromId) return Number(fromId[1]) * 1000;
  const fromImage = /\/(\d{9,})\.[a-z0-9]+$/i.exec(organism.image);
  if (fromImage) return Number(fromImage[1]) * 1000;
  return new Date(organism.addedAt).getTime();
}

function monthKey(ms: number): { key: string; rank: number; label: string } {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = d.getMonth();
  return {
    key: `${year}-${month}`,
    rank: year * 12 + month,
    label: `${MONTH_NAMES[month]} ${year}`,
  };
}

/**
 * For the newest/oldest sort modes, decide which organisms start a new
 * month/year section and should be preceded by a labeled month header.
 *
 * A month/year qualifies for a header when it is the newest month present
 * (which by definition has ≥1 pic) or when it contains at least three pics.
 * Time is taken from the image itself (see `imageTime`), not `addedAt`.
 *
 * `organisms` must already be in the order they will be laid out. Returns a
 * map from the leading organism's id to the header label to render before it.
 */
export function computeMonthMarkers(organisms: Organism[], mode: SortMode): Map<string, string> {
  const markers = new Map<string, string>();
  if (mode !== "newest" && mode !== "oldest") return markers;

  const counts = new Map<string, number>();
  let newestKey = "";
  let newestRank = -Infinity;
  for (const o of organisms) {
    const { key, rank } = monthKey(imageTime(o));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (rank > newestRank) {
      newestRank = rank;
      newestKey = key;
    }
  }

  const qualifies = (key: string) => key === newestKey || (counts.get(key) ?? 0) >= 3;

  let prevKey: string | null = null;
  for (const o of organisms) {
    const { key, label } = monthKey(imageTime(o));
    if (key !== prevKey) {
      prevKey = key;
      if (qualifies(key)) markers.set(o.id, label);
    }
  }
  return markers;
}

export async function sortOrganismsAsync(
  organisms: Organism[],
  mode: SortMode,
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
    withoutHash.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
    if (withHash.length <= 1) return [...withHash, ...withoutHash];
    const result = nearestNeighborChain(withHash, (a, b) =>
      hammingDistanceHex(meta[a.id].phash, meta[b.id].phash),
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
