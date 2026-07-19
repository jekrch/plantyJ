import type { OrganismRecord, Species, SpeciesReference, SpeciesTaxonomy, TaxaInfo } from "../types";
import { isDriveMode, loadJson, notifyDataChanged } from "./source";
import { driveSaveJson } from "./driveSource";
import { slugifyName } from "../hooks/useOrganismData";

/**
 * Phase 4 — local enrichment. Browser port of the GitHub Actions metadata
 * pipeline (`scripts/metadata`). Runs opportunistically ("Enrich now") against
 * the signed-in user's Drive garden, filling `species.json` + `taxa.json` from
 * public CORS-friendly APIs so the Tree View, taxonomy drawer, and species
 * descriptions light up without any server.
 *
 * Same gating as the pipeline: a per-species `sources` list ensures each API is
 * hit at most once per species, and `species.json` is persisted after every
 * species so an interrupted session resumes where it left off.
 */

const SOURCE_GBIF = "gbif";
const SOURCE_WIKIPEDIA = "wikipedia";
const SOURCE_POWO = "powo";

const TAXA_RANKS: Array<keyof SpeciesTaxonomy> = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
];

export interface EnrichProgress {
  label: string;
  done: number;
  total: number;
}

export interface EnrichResult {
  speciesUpdated: number;
  taxaAdded: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hasSource(entry: Species, id: string): boolean {
  return (entry.sources ?? []).includes(id);
}
function markSource(entry: Species, id: string): void {
  if (!entry.sources) entry.sources = [];
  if (!entry.sources.includes(id)) entry.sources.push(id);
}
function ensureReference(entry: Species, name: string, url: string): void {
  if (!entry.references) entry.references = [];
  const key = name.trim().toLowerCase();
  if (entry.references.some((r: SpeciesReference) => (r.name || "").trim().toLowerCase() === key)) {
    return;
  }
  entry.references.push({ name, url });
}

function isMeaningful(text: string): boolean {
  const t = text.trim();
  return t.length >= 30 && !/\bmay refer to\b/i.test(t);
}

// ── GBIF: canonical taxonomy + English vernaculars ───────────────────────

interface GbifMatch {
  matchType?: string;
  usageKey?: number;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  canonicalName?: string;
}

async function gbifMatch(name: string): Promise<GbifMatch | null> {
  const res = await fetch(
    `https://api.gbif.org/v1/species/match?verbose=true&name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as GbifMatch;
  if (!data.matchType || data.matchType === "NONE") return null;
  return data;
}

async function gbifVernacular(key: number): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.gbif.org/v1/species/${key}/vernacularNames?limit=50`,
    );
    if (!res.ok) return [];
    const results = ((await res.json()) as { results?: Array<{ language?: string; vernacularName?: string }> })
      .results ?? [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.language && r.language.toLowerCase() !== "eng") continue;
      const nm = (r.vernacularName ?? "").trim();
      const k = nm.toLowerCase();
      if (nm && !seen.has(k)) {
        seen.add(k);
        names.push(nm);
      }
    }
    return names;
  } catch {
    return [];
  }
}

async function runGbif(entry: Species): Promise<boolean> {
  if (hasSource(entry, SOURCE_GBIF)) return false;
  if (!entry.fullName) {
    markSource(entry, SOURCE_GBIF);
    return true;
  }
  try {
    const match = await gbifMatch(entry.fullName);
    if (match?.usageKey) {
      entry.taxonomy = {
        kingdom: match.kingdom ?? null,
        phylum: match.phylum ?? null,
        class: match.class ?? null,
        order: match.order ?? null,
        family: match.family ?? null,
        genus: match.genus ?? null,
        species: match.species ?? null,
        canonicalName: match.canonicalName ?? null,
      };
      ensureReference(entry, "GBIF", `https://www.gbif.org/species/${match.usageKey}`);
      const vernacular = await gbifVernacular(match.usageKey);
      if (vernacular.length) entry.vernacularNames = vernacular;
    }
  } catch {
    // Network/transient failure — mark handled to preserve "hit once" semantics.
  }
  markSource(entry, SOURCE_GBIF);
  await sleep(300);
  return true;
}

// ── Wikipedia REST summary: species description ──────────────────────────

async function wikiSummary(title: string): Promise<{ extract: string; url: string } | null> {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    type?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (data.type === "disambiguation") return null;
  return { extract: data.extract ?? "", url: data.content_urls?.desktop?.page ?? "" };
}

async function runWikipedia(entry: Species): Promise<boolean> {
  if (hasSource(entry, SOURCE_WIKIPEDIA)) return false;
  if (entry.description || !entry.fullName) {
    markSource(entry, SOURCE_WIKIPEDIA);
    return true;
  }
  // Wikipedia rarely has cultivar pages; fall back to the base species.
  const base = entry.fullName.replace(/\s*'[^']+'\s*$/, "").trim();
  try {
    const summary = await wikiSummary(base);
    if (summary && isMeaningful(summary.extract)) {
      entry.description = summary.extract;
      ensureReference(
        entry,
        "Wikipedia",
        summary.url || `https://en.wikipedia.org/wiki/${encodeURIComponent(base.replace(/ /g, "_"))}`,
      );
    }
  } catch {
    // ignore
  }
  markSource(entry, SOURCE_WIKIPEDIA);
  await sleep(400);
  return true;
}

// ── POWO: native range (best-effort; no public CORS contract) ────────────

interface PowoResult {
  accepted?: boolean;
  fqId?: string;
  distribution?: { natives?: Array<{ name?: string }> };
}

async function powoLookup(name: string): Promise<PowoResult | null> {
  const res = await fetch(
    `https://powo.science.kew.org/api/2/search?perPage=5&q=${encodeURIComponent(name)}`,
  );
  if (!res.ok) return null;
  const results = ((await res.json()) as { results?: PowoResult[] }).results ?? [];
  if (!results.length) return null;
  const accepted = results.find((r) => r.accepted) ?? results[0];
  if (!accepted.fqId) return null;
  try {
    const detail = await fetch(`https://powo.science.kew.org/api/2/taxon/${accepted.fqId}`);
    if (detail.ok) return { ...accepted, ...((await detail.json()) as PowoResult) };
  } catch {
    // fall through to search-level result
  }
  return accepted;
}

async function runPowo(entry: Species): Promise<boolean> {
  if (hasSource(entry, SOURCE_POWO)) return false;
  if (entry.nativeRange || !entry.fullName) {
    markSource(entry, SOURCE_POWO);
    return true;
  }
  try {
    const match = await powoLookup(entry.fullName);
    if (match) {
      const names = (match.distribution?.natives ?? [])
        .map((n) => n.name)
        .filter((n): n is string => !!n);
      if (names.length) entry.nativeRange = names.join(", ");
      if (match.fqId) {
        ensureReference(entry, "POWO", `https://powo.science.kew.org/taxon/${match.fqId}`);
      }
    }
  } catch {
    // POWO frequently blocks cross-origin requests — degrade gracefully.
  }
  markSource(entry, SOURCE_POWO);
  await sleep(300);
  return true;
}

// ── Taxa registry: descriptions for higher-level ranks ───────────────────

async function buildTaxaRegistry(
  entries: Species[],
  taxa: Record<string, TaxaInfo>,
  onProgress?: (p: EnrichProgress) => void,
): Promise<number> {
  const unique = new Set<string>();
  for (const e of entries) {
    if (!e.taxonomy) continue;
    for (const rank of TAXA_RANKS) {
      const value = e.taxonomy[rank];
      if (typeof value === "string" && value.trim()) unique.add(value.trim());
    }
  }
  const missing = [...unique].sort().filter((t) => !(t in taxa));
  let i = 0;
  for (const taxon of missing) {
    onProgress?.({ label: `Taxon: ${taxon}`, done: ++i, total: missing.length });
    try {
      const summary = await wikiSummary(taxon);
      taxa[taxon] = { description: summary?.extract ?? "", url: summary?.url ?? "" };
    } catch {
      taxa[taxon] = { description: "", url: "" };
    }
    await sleep(400);
  }
  return missing.length;
}

// ── Seeding: ensure a species entry per distinct plant fullName ──────────

function seedSpecies(bundle: Record<string, Species>, plants: OrganismRecord[]): void {
  const seen = new Set<string>();
  for (const p of plants) {
    const fullName = (p.fullName ?? "").trim();
    if (!fullName || seen.has(fullName)) continue;
    seen.add(fullName);
    const slug = slugifyName(fullName);
    if (bundle[slug]) continue;
    bundle[slug] = {
      id: slug,
      fullName,
      commonName: p.commonName ?? null,
      description: null,
      vernacularNames: [],
      taxonomy: null,
      nativeRange: null,
      references: [],
      sources: [],
    };
  }
}

export async function enrichGarden(
  onProgress?: (p: EnrichProgress) => void,
): Promise<EnrichResult> {
  if (!isDriveMode()) throw new Error("Enrichment is only available for your Drive garden");

  const [plantsFile, speciesFile, taxaFile] = await Promise.all([
    loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
    loadJson<{ species?: Record<string, Species> }>("species.json"),
    loadJson<Record<string, TaxaInfo>>("taxa.json"),
  ]);
  const plants = plantsFile.plants ?? [];
  const bundle = speciesFile.species ?? {};
  const taxa = taxaFile ?? {};

  seedSpecies(bundle, plants);
  const entries = Object.keys(bundle)
    .sort()
    .map((k) => bundle[k]);

  let speciesUpdated = 0;
  let i = 0;
  for (const entry of entries) {
    onProgress?.({ label: entry.fullName ?? entry.id, done: ++i, total: entries.length });
    let changed = false;
    // Sequential so we stay polite to each API and can persist between species.
    if (await runGbif(entry)) changed = true;
    if (await runWikipedia(entry)) changed = true;
    if (await runPowo(entry)) changed = true;
    if (changed) {
      // Persist progress after each touched species (pipeline resumability).
      // Untouched species (already fully enriched) skip the write on re-runs.
      await driveSaveJson("species.json", { species: bundle });
      speciesUpdated++;
    }
  }

  const taxaAdded = await buildTaxaRegistry(entries, taxa, onProgress);
  if (taxaAdded > 0) await driveSaveJson("taxa.json", taxa);

  notifyDataChanged();
  return { speciesUpdated, taxaAdded };
}

// Coalesced background runner so the upload path can trigger enrichment
// automatically without blocking the UI or double-hitting the APIs.
let bgRunning = false;
let bgPending = false;

/**
 * Fire-and-forget enrichment for the upload path. Runs the same pipeline as the
 * manual "Enrich my garden" action, but off the critical path: newly added
 * species get taxonomy/description/native-range filled in as soon as their
 * photo is saved. Per-species `sources` gating keeps a re-run cheap — already
 * enriched species are skipped, so this only touches the just-added ones.
 *
 * Runs are coalesced: a burst of uploads results in at most one in-flight pass
 * plus one trailing pass, so species added mid-run still get picked up. Errors
 * are swallowed — enrichment is best-effort and must never break an upload.
 */
export function enrichGardenInBackground(): void {
  if (!isDriveMode()) return;
  if (bgRunning) {
    bgPending = true;
    return;
  }
  bgRunning = true;
  void (async () => {
    try {
      do {
        bgPending = false;
        await enrichGarden();
      } while (bgPending);
    } catch {
      // Best-effort: a failed background enrichment is retried on the next
      // upload, and the manual "Enrich my garden" action remains available.
    } finally {
      bgRunning = false;
    }
  })();
}
