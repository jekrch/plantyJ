import { useEffect, useState } from "react";
import type {
  AIAnalysis,
  Annotation,
  PicRecord,
  Organism,
  OrganismRecord,
  Species,
  TaxaInfo,
  Zone,
  ZonePic,
} from "../types";
import { useRelationships, type RelationshipsData } from "./useRelationships";

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Merges raw pic records with their plant metadata (looked up by shortCode).
 * Pics with no matching plant record keep null name fields.
 */
export function mergeOrganisms(
  pics: PicRecord[],
  plantRecords: OrganismRecord[]
): Organism[] {
  const byCode = new Map<string, OrganismRecord>();
  for (const p of plantRecords) byCode.set(p.shortCode, p);
  return pics.map((pic) => {
    const organism = byCode.get(pic.shortCode);
    return {
      ...pic,
      fullName: organism?.fullName ?? null,
      commonName: organism?.commonName ?? null,
      variety: organism?.variety ?? null,
    };
  });
}

/**
 * Maps each plant's shortCode to its species entry, resolving the species
 * bundle by the slugified full name. Plants without a full name or without a
 * matching species are omitted.
 */
export function buildSpeciesMap(
  plantRecords: OrganismRecord[],
  speciesBySlug: Record<string, Species>
): Map<string, Species> {
  const m = new Map<string, Species>();
  for (const p of plantRecords) {
    if (!p.fullName) continue;
    const sp = speciesBySlug[slugifyName(p.fullName)];
    if (sp) m.set(p.shortCode, sp);
  }
  return m;
}

export type LoadStatus = "loading" | "ready" | "error";

export interface OrganismData {
  organisms: Organism[];
  organismRecords: OrganismRecord[];
  zones: Zone[];
  zonePics: ZonePic[];
  annotations: Annotation[];
  speciesByShortCode: Map<string, Species>;
  speciesLoaded: boolean;
  taxa: Record<string, TaxaInfo>;
  aiAnalyses: AIAnalysis[];
  relationships: RelationshipsData;
  status: LoadStatus;
}

/**
 * Loads and merges all static JSON data bundles (pics, plants, zones, taxa,
 * species, AI analysis). The core bundles gate `status`; species and AI
 * analysis stream in afterwards and are non-blocking.
 */
export function useOrganismData(): OrganismData {
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [organismRecords, setOrganismRecords] = useState<OrganismRecord[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonePics, setZonePics] = useState<ZonePic[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [speciesByShortCode, setSpeciesByShortCode] = useState<
    Map<string, Species>
  >(new Map());
  const [speciesLoaded, setSpeciesLoaded] = useState(false);
  const [taxa, setTaxa] = useState<Record<string, TaxaInfo>>({});
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const relationships = useRelationships();

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const fetchJson = <T,>(path: string) =>
      fetch(`${base}${path}`).then((res) => {
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return res.json() as Promise<T>;
      });

    Promise.all([
      fetchJson<{ pics?: PicRecord[] }>("data/pics.json"),
      fetchJson<{ plants?: OrganismRecord[] }>("data/plants.json"),
      fetchJson<{ zones?: Zone[] }>("data/zones.json"),
      fetchJson<{ zonePics?: ZonePic[] }>("data/zone_pics.json").catch(
        () => ({ zonePics: [] as ZonePic[] })
      ),
      fetchJson<{ annotations?: Annotation[] }>("data/annotations.json").catch(
        () => ({ annotations: [] as Annotation[] })
      ),
      fetchJson<Record<string, TaxaInfo>>("data/taxa.json").catch(
        () => ({} as Record<string, TaxaInfo>)
      ),
    ])
      .then(
        ([
          picsData,
          organismsData,
          zonesData,
          zonePicsData,
          annotationsData,
          taxaData,
        ]) => {
          const records = organismsData.plants ?? [];
          setOrganisms(mergeOrganisms(picsData.pics ?? [], records));
          setOrganismRecords(records);
          setZones(zonesData.zones ?? []);
          setZonePics(zonePicsData.zonePics ?? []);
          setAnnotations(annotationsData.annotations ?? []);
          setTaxa(taxaData ?? {});
          setStatus("ready");

          // Load combined species bundle — non-blocking; fills in once available.
          fetchJson<{ species?: Record<string, Species> }>("data/species.json")
            .then((bundle) => {
              setSpeciesByShortCode(
                buildSpeciesMap(records, bundle.species ?? {})
              );
            })
            .catch(() => {
              setSpeciesByShortCode(new Map());
            })
            .finally(() => {
              setSpeciesLoaded(true);
            });
        }
      )
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/ai_analysis.json`)
      .then((res) => res.json())
      .then((data) => setAiAnalyses(data.analyses ?? []))
      .catch(() => setAiAnalyses([]));
  }, []);

  return {
    organisms,
    organismRecords,
    zones,
    zonePics,
    annotations,
    speciesByShortCode,
    speciesLoaded,
    taxa,
    aiAnalyses,
    relationships,
    status,
  };
}
