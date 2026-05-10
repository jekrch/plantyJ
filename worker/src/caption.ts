import type { ParsedCaption, ParsedTags, ParsedZoneRef, PicEntry, PlantRecord, Zone } from "./types";
import { assertValidCode } from "./validation";

export const UNIDENTIFIED_CODE = "id";
export const UNIDENTIFIED_PREFIX = "unid-";

/**
 * Parse a Telegram caption into structured plant + pic metadata.
 *
 * Format (// delimited):
 *   shortCode // fullName ['Variety'] // commonName // zone // tags // description
 *
 * Plant-level fields (fullName, commonName) live on the plant record,
 * keyed by shortCode. Pic-level fields (zone, tags, description) live on
 * the pic. The zone segment is a single zone — either a bare code (`fb1`)
 * or `Display Name (zoneCode)` to declare the name.
 *
 * Special shortCode `id` marks the pic as unidentified — the user doesn't
 * know what the plant is yet. Format collapses to `id // zone [// description]`
 * and skips fullName/commonName/tags slots. The worker assigns a unique
 * `unid-{seq}` shortCode and leaves plant fields null until accepted via
 * `/accept` (BioCLIP prediction) or filled in via `/update`.
 */
export function parseCaption(caption: string): ParsedCaption {
  const text = caption.trim();
  const parts = text.split("//").map((s) => s.trim());
  const shortCode = parts[0];
  if (!shortCode) {
    throw new Error("Caption must start with a shortCode.");
  }
  assertValidCode("shortCode", shortCode);

  if (shortCode.toLowerCase() === UNIDENTIFIED_CODE) {
    const zoneRaw = parts[1] || null;
    const zone = zoneRaw ? parseZoneRef(zoneRaw) : null;
    const description = parts[2] ? parts[2] : null;
    return {
      shortCode: UNIDENTIFIED_CODE,
      fullName: null,
      commonName: null,
      variety: null,
      zone,
      tags: null,
      description,
    };
  }

  const rawFullName = parts[1] ? parts[1] : null;
  const { fullName, variety } = extractVariety(rawFullName);
  const commonName = parts[2] ? parts[2] : null;

  const zoneRaw = parts[3] ? parts[3] : null;
  const zone = zoneRaw ? parseZoneRef(zoneRaw) : null;

  const tags = parts[4] ? parseTags(parts[4]) : null;
  const description = parts[5] ? parts[5] : null;

  return { shortCode, fullName, commonName, variety, zone, tags, description };
}

export function isUnidentifiedShortCode(shortCode: string): boolean {
  return shortCode.startsWith(UNIDENTIFIED_PREFIX);
}

function extractVariety(raw: string | null): { fullName: string | null; variety: string | null } {
  if (!raw) return { fullName: null, variety: null };
  const m = raw.match(/^(.*?)\s*'([^']+)'\s*$/);
  if (m) return { fullName: m[1].trim() || null, variety: m[2].trim() };
  return { fullName: raw, variety: null };
}

function parseZoneRef(segment: string): ParsedZoneRef {
  if (segment.includes("+")) {
    throw new Error(
      "A picture can only belong to one zone. Post a separate photo for each zone."
    );
  }
  const trimmed = segment.trim();
  const m = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const name = m[1].trim();
    const code = m[2].trim();
    assertValidCode("zoneCode", code);
    return { code, name: name || null };
  }
  assertValidCode("zoneCode", trimmed);
  return { code: trimmed, name: null };
}

function parseTags(raw: string): ParsedTags {
  const picTags: string[] = [];
  const zoneTags: string[] = [];
  const plantTags: string[] = [];
  for (const t of raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)) {
    if (t.startsWith("++")) {
      plantTags.push(t.slice(2).trim());
    } else if (t.startsWith("+")) {
      zoneTags.push(t.slice(1).trim());
    } else {
      picTags.push(t);
    }
  }
  return { picTags, zoneTags, plantTags };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface ResolvedPlantUpsert {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  variety: string | null;
}

export interface ResolvedPic {
  shortCode: string;
  zoneCode: string;
  tags: string[];
  description: string | null;
}

export interface AnnotationTags {
  plantTags: string[];
  zoneTags: string[];
}

export interface ResolveResult {
  pic: ResolvedPic;
  /** Plant record to create or fill in (only when new or has new info to backfill). */
  plantUpsert: ResolvedPlantUpsert | null;
  /** Zone records that should be created or renamed in the registry. */
  zoneUpserts: Zone[];
  /** Tags prefixed with ++ (plant-level) or + (plant+zone-level) to upsert as annotations. */
  annotationTags: AnnotationTags;
}

/**
 * Resolve the caption into a pic + (optional) plant upsert.
 *
 * Plant fields (fullName, commonName) come from the existing plant record
 * if present. If the plant is new, fullName is required and the plant is
 * registered. If a known plant has missing fields and the caption supplies
 * them, those gaps are filled (caption never overwrites existing plant data
 * — use /update for that).
 *
 * Pic fields (zone, tags) inherit from the most recent prior pic of the same
 * plant when not supplied in the caption.
 */
export function resolveFields(
  parsed: ParsedCaption,
  existingPics: PicEntry[],
  plants: PlantRecord[],
  zones: Zone[]
): ResolveResult {
  const isUnidentified = parsed.shortCode === UNIDENTIFIED_CODE;
  const priorPic = isUnidentified
    ? null
    : existingPics.find((p) => p.shortCode === parsed.shortCode);
  const existingPlant = isUnidentified
    ? undefined
    : plants.find((p) => p.shortCode === parsed.shortCode);

  let zoneCode: string;
  const zoneUpserts: Zone[] = [];

  if (parsed.zone) {
    zoneCode = parsed.zone.code;
    const existingZone = zones.find((z) => z.code === parsed.zone!.code);
    if (!existingZone) {
      zoneUpserts.push({ code: parsed.zone.code, name: parsed.zone.name });
    } else if (parsed.zone.name && parsed.zone.name !== existingZone.name) {
      zoneUpserts.push({ code: parsed.zone.code, name: parsed.zone.name });
    }
  } else if (priorPic) {
    zoneCode = priorPic.zoneCode;
  } else if (isUnidentified) {
    throw new Error(
      `Unidentified pics need a zone. Use: id // zoneCode [// description]`
    );
  } else {
    throw new Error(
      `New plant "${parsed.shortCode}" needs a zone. Use: shortCode // fullName // commonName // Zone Name (zoneCode)`
    );
  }

  if (!zoneCode) {
    throw new Error(`Plant "${parsed.shortCode}" must belong to a zone.`);
  }

  const tags = parsed.tags?.picTags ?? priorPic?.tags ?? [];
  const annotationTags: AnnotationTags = {
    plantTags: parsed.tags?.plantTags ?? [],
    zoneTags: parsed.tags?.zoneTags ?? [],
  };

  if (isUnidentified) {
    return {
      pic: {
        shortCode: UNIDENTIFIED_CODE,
        zoneCode,
        tags: [],
        description: parsed.description,
      },
      plantUpsert: null,
      zoneUpserts,
      annotationTags: { plantTags: [], zoneTags: [] },
    };
  }

  if (!existingPlant && !parsed.fullName) {
    throw new Error(
      `New shortCode "${parsed.shortCode}" needs a fullName. Use: shortCode // Genus species 'Variety' // Common Name // Zone (code)`
    );
  }

  let plantUpsert: ResolvedPlantUpsert | null = null;
  if (!existingPlant) {
    plantUpsert = {
      shortCode: parsed.shortCode,
      fullName: parsed.fullName,
      commonName: parsed.commonName,
      variety: parsed.variety,
    };
  } else {
    // Backfill missing fields only — don't overwrite existing plant data.
    const fullName = existingPlant.fullName ?? parsed.fullName ?? null;
    const commonName = existingPlant.commonName ?? parsed.commonName ?? null;
    const variety = existingPlant.variety ?? parsed.variety ?? null;
    if (
      fullName !== existingPlant.fullName ||
      commonName !== existingPlant.commonName ||
      variety !== (existingPlant.variety ?? null)
    ) {
      plantUpsert = {
        shortCode: parsed.shortCode,
        fullName,
        commonName,
        variety,
      };
    }
  }

  return {
    pic: {
      shortCode: parsed.shortCode,
      zoneCode,
      tags,
      description: parsed.description,
    },
    plantUpsert,
    zoneUpserts,
    annotationTags,
  };
}
