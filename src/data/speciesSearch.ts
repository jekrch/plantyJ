import type { Species } from "../types";

/**
 * Species lookup for the "add a new plant" flow. Combines two sources so a
 * Drive user can type a common or scientific name and pick a match:
 *
 *  1. The curated PlantyJ dataset (`public/data/species.json`) — instant,
 *     high-quality common names for anything already documented here.
 *  2. iNaturalist's taxa autocomplete — a large external catalogue that
 *     matches both vernacular and scientific names and is CORS-friendly.
 *
 * Results are pure data (scientific + common name); selecting one just
 * pre-fills the form fields, which stay editable.
 */

export interface SpeciesMatch {
  /** Scientific / full name → OrganismRecord.fullName. */
  scientificName: string;
  /** Common name → OrganismRecord.commonName (may be absent externally). */
  commonName: string | null;
  /** Taxonomic rank, e.g. "species", "variety" (external only). */
  rank: string | null;
  /** Coarse group for a badge, e.g. kingdom or iNat iconic taxon. */
  group: string | null;
  source: "dataset" | "inaturalist";
}

const dedupeKey = (name: string) => name.trim().toLowerCase();

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// ── Internal curated dataset ─────────────────────────────────────────────

let datasetPromise: Promise<Species[]> | null = null;

/** Load and cache the bundled curated species catalogue (never the user's Drive copy). */
function loadDataset(): Promise<Species[]> {
  if (!datasetPromise) {
    datasetPromise = fetch(`${import.meta.env.BASE_URL}data/species.json`)
      .then((r) => (r.ok ? r.json() : { species: {} }))
      .then((d: { species?: Record<string, Species> }) => Object.values(d.species ?? {}))
      .catch(() => []);
  }
  return datasetPromise;
}

/**
 * Substring-match the curated dataset on scientific, common, and vernacular
 * names. Prefix matches rank ahead of interior matches.
 */
export function searchDataset(entries: Species[], query: string, limit = 6): SpeciesMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ score: number; match: SpeciesMatch }> = [];
  for (const e of entries) {
    if (!e.fullName) continue;
    const haystacks = [e.fullName, e.commonName, ...(e.vernacularNames ?? [])];
    let best = Infinity;
    for (const h of haystacks) {
      if (!h) continue;
      const idx = h.toLowerCase().indexOf(q);
      if (idx >= 0) best = Math.min(best, idx === 0 ? 0 : 1);
    }
    if (best === Infinity) continue;
    scored.push({
      score: best,
      match: {
        scientificName: e.fullName,
        commonName: e.commonName,
        rank: "species",
        group: e.taxonomy?.kingdom ?? null,
        source: "dataset",
      },
    });
  }
  scored.sort(
    (a, b) => a.score - b.score || a.match.scientificName.localeCompare(b.match.scientificName),
  );
  return scored.slice(0, limit).map((s) => s.match);
}

// ── External catalogue (iNaturalist) ─────────────────────────────────────

interface INatTaxon {
  name?: string;
  preferred_common_name?: string;
  rank?: string;
  iconic_taxon_name?: string;
}

// Ranks worth offering when adding a specific plant. iNat also returns
// families/orders/etc. for broad queries, which aren't useful here.
const USEFUL_RANKS = new Set([
  "species",
  "subspecies",
  "variety",
  "form",
  "hybrid",
  "genus",
]);

export function parseInaturalist(results: INatTaxon[]): SpeciesMatch[] {
  const out: SpeciesMatch[] = [];
  for (const t of results) {
    if (!t.name) continue;
    if (t.rank && !USEFUL_RANKS.has(t.rank)) continue;
    out.push({
      scientificName: t.name,
      commonName: t.preferred_common_name ? capitalize(t.preferred_common_name) : null,
      rank: t.rank ?? null,
      group: t.iconic_taxon_name ?? null,
      source: "inaturalist",
    });
  }
  return out;
}

async function searchInaturalist(
  query: string,
  signal?: AbortSignal,
  limit = 8,
): Promise<SpeciesMatch[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa/autocomplete?per_page=${limit}&q=${encodeURIComponent(q)}`,
      { signal },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: INatTaxon[] };
    return parseInaturalist(data.results ?? []);
  } catch {
    // Aborted (superseded query) or network/CORS failure — dataset still stands.
    return [];
  }
}

// ── Merge ────────────────────────────────────────────────────────────────

/** Dataset matches first (curated common names win on dedupe), then external. */
export function mergeMatches(
  dataset: SpeciesMatch[],
  external: SpeciesMatch[],
  limit = 8,
): SpeciesMatch[] {
  const seen = new Set<string>();
  const out: SpeciesMatch[] = [];
  for (const m of [...dataset, ...external]) {
    const key = dedupeKey(m.scientificName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Search both sources for `query`. The dataset resolves synchronously (cached
 * after first load); iNaturalist is awaited and may be aborted via `signal`.
 */
export async function searchSpecies(
  query: string,
  signal?: AbortSignal,
  limit = 8,
): Promise<SpeciesMatch[]> {
  if (!query.trim()) return [];
  const [dataset, external] = await Promise.all([
    loadDataset().then((entries) => searchDataset(entries, query)),
    searchInaturalist(query, signal),
  ]);
  return mergeMatches(dataset, external, limit);
}

// ── Short-code suggestion ────────────────────────────────────────────────

/**
 * Suggest a short code in the project's convention (genus initial + first
 * letters of the species epithet, e.g. "Asclepias syriaca" → "A syr"),
 * falling back to the common name, disambiguated against `taken` codes.
 */
export function suggestShortCode(
  scientificName: string | null,
  commonName: string | null,
  taken: Set<string>,
): string {
  const clean = (s: string) => s.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  let base = "";
  const sci = scientificName ? clean(scientificName) : [];
  if (sci.length >= 2) {
    base = `${sci[0].charAt(0).toUpperCase()} ${sci[1].slice(0, 3).toLowerCase()}`;
  } else if (sci.length === 1) {
    base = sci[0].slice(0, 4).toLowerCase();
  } else if (commonName) {
    const words = clean(commonName);
    base = words
      .slice(0, 2)
      .map((w) => w.slice(0, 3).toLowerCase())
      .join("-");
  }
  if (!base) return "";
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}
