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
import { DATA_CHANGED_EVENT, isDriveMode, loadJson } from "../data/source";
import { AUTH_CHANGED_EVENT, getAccessToken } from "../data/googleAuth";
import { initDrive } from "../data/driveSource";
import { DriveAuthError } from "../data/driveClient";

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
export function mergeOrganisms(pics: PicRecord[], plantRecords: OrganismRecord[]): Organism[] {
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
  speciesBySlug: Record<string, Species>,
): Map<string, Species> {
  const m = new Map<string, Species>();
  for (const p of plantRecords) {
    if (!p.fullName) continue;
    const sp = speciesBySlug[slugifyName(p.fullName)];
    if (sp) m.set(p.shortCode, sp);
  }
  return m;
}

export type LoadStatus = "loading" | "ready" | "error" | "needs-auth";

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
  const [speciesByShortCode, setSpeciesByShortCode] = useState<Map<string, Species>>(new Map());
  const [speciesLoaded, setSpeciesLoaded] = useState(false);
  const [taxa, setTaxa] = useState<Record<string, TaxaInfo>>({});
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const relationships = useRelationships();

  // Refetch after any mutation or auth change (sign-in unlocks Drive mode).
  useEffect(() => {
    const bump = () => setReloadKey((k) => k + 1);
    window.addEventListener(DATA_CHANGED_EVENT, bump);
    window.addEventListener(AUTH_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, bump);
      window.removeEventListener(AUTH_CHANGED_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (isDriveMode()) {
        if (!getAccessToken()) {
          setStatus("needs-auth");
          return;
        }
        setStatus("loading");
        try {
          await initDrive();
        } catch (err) {
          if (cancelled) return;
          setStatus(err instanceof DriveAuthError ? "needs-auth" : "error");
          return;
        }
      }

      const [picsData, organismsData, zonesData, zonePicsData, annotationsData, taxaData] =
        await Promise.all([
          loadJson<{ pics?: PicRecord[] }>("pics.json"),
          loadJson<{ plants?: OrganismRecord[] }>("plants.json"),
          loadJson<{ zones?: Zone[] }>("zones.json"),
          loadJson<{ zonePics?: ZonePic[] }>("zone_pics.json").catch(() => ({
            zonePics: [] as ZonePic[],
          })),
          loadJson<{ annotations?: Annotation[] }>("annotations.json").catch(() => ({
            annotations: [] as Annotation[],
          })),
          loadJson<Record<string, TaxaInfo>>("taxa.json").catch(
            () => ({}) as Record<string, TaxaInfo>,
          ),
        ]);
      if (cancelled) return;

      const records = organismsData.plants ?? [];
      setOrganisms(mergeOrganisms(picsData.pics ?? [], records));
      setOrganismRecords(records);
      setZones(zonesData.zones ?? []);
      setZonePics(zonePicsData.zonePics ?? []);
      setAnnotations(annotationsData.annotations ?? []);
      setTaxa(taxaData ?? {});
      setStatus("ready");

      // Load combined species bundle — non-blocking; fills in once available.
      loadJson<{ species?: Record<string, Species> }>("species.json")
        .then((bundle) => {
          if (!cancelled) setSpeciesByShortCode(buildSpeciesMap(records, bundle.species ?? {}));
        })
        .catch(() => {
          if (!cancelled) setSpeciesByShortCode(new Map());
        })
        .finally(() => {
          if (!cancelled) setSpeciesLoaded(true);
        });
    }

    load().catch(() => {
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    loadJson<{ analyses?: AIAnalysis[] }>("ai_analysis.json")
      .then((data) => {
        if (!cancelled) setAiAnalyses(data.analyses ?? []);
      })
      .catch(() => {
        if (!cancelled) setAiAnalyses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

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
