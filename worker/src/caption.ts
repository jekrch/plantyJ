import type { ParsedCaption, ParsedZoneRef, PicEntry, PlantRecord, Zone } from "./types";

/**
 * Parse a Telegram caption into structured plant + pic metadata.
 *
 * Format (// delimited):
 *   shortCode // fullName // commonName // zone // tags // description
 *
 * Plant-level fields (fullName, commonName) live on the plant record,
 * keyed by shortCode. Pic-level fields (zone, tags, description) live on
 * the pic. The zone segment is a single zone — either a bare code (`fb1`)
 * or `Display Name (zoneCode)` to declare the name.
 */
export function parseCaption(caption: string): ParsedCaption {
  const parts = caption.split("//").map((s) => s.trim());
  const shortCode = parts[0];
  if (!shortCode) {
    throw new Error("Caption must start with a shortCode.");
  }

  const fullName = parts[1] ? parts[1] : null;
  const commonName = parts[2] ? parts[2] : null;

  const zoneRaw = parts[3] ? parts[3] : null;
  const zone = zoneRaw ? parseZoneRef(zoneRaw) : null;

  const tags = parts[4] ? parseTags(parts[4]) : null;
  const description = parts[5] ? parts[5] : null;

  return { shortCode, fullName, commonName, zone, tags, description };
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
    return { code: m[2].trim(), name: name || null };
  }
  return { code: trimmed, name: null };
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
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
}

export interface ResolvedPic {
  shortCode: string;
  zoneCode: string;
  tags: string[];
  description: string | null;
}

export interface ResolveResult {
  pic: ResolvedPic;
  /** Plant record to create or fill in (only when new or has new info to backfill). */
  plantUpsert: ResolvedPlantUpsert | null;
  /** Zone records that should be created or renamed in the registry. */
  zoneUpserts: Zone[];
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
  const priorPic = existingPics.find((p) => p.shortCode === parsed.shortCode);
  const existingPlant = plants.find((p) => p.shortCode === parsed.shortCode);

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
  } else {
    throw new Error(
      `New plant "${parsed.shortCode}" needs a zone. Use: shortCode // fullName // commonName // Zone Name (zoneCode)`
    );
  }

  if (!zoneCode) {
    throw new Error(`Plant "${parsed.shortCode}" must belong to a zone.`);
  }

  const tags = parsed.tags ?? priorPic?.tags ?? [];

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
    };
  } else {
    // Backfill missing fields only — don't overwrite existing plant data.
    const fullName = existingPlant.fullName ?? parsed.fullName ?? null;
    const commonName = existingPlant.commonName ?? parsed.commonName ?? null;
    if (fullName !== existingPlant.fullName || commonName !== existingPlant.commonName) {
      plantUpsert = {
        shortCode: parsed.shortCode,
        fullName,
        commonName,
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
  };
}
