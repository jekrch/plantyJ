import type { ParsedCaption, ParsedZoneRef, PlantEntry, Zone } from "./types";

/**
 * Parse a Telegram caption into structured plant metadata.
 *
 * Format (// delimited):
 *   shortCode // fullName // commonName // zones // tags // description
 *
 * The zones segment accepts one or more zones separated by `+`. Each zone is
 * either a bare code (`fb1`) or `Display Name (zoneCode)` to declare the name.
 *
 * Examples:
 *   tmt-c // Solanum lycopersicum // Cherokee Purple // Front Bed 1 (fb1) // edible // first ripe
 *   tmt-c // // // fb1 + sb // // sizing up nicely
 *   tmt-c
 */
export function parseCaption(caption: string): ParsedCaption {
  const parts = caption.split("//").map((s) => s.trim());
  const shortCode = parts[0];
  if (!shortCode) {
    throw new Error("Caption must start with a shortCode.");
  }

  const fullName = parts[1] ? parts[1] : null;
  const commonName = parts[2] ? parts[2] : null;

  const zonesRaw = parts[3] ? parts[3] : null;
  const zones = zonesRaw ? parseZones(zonesRaw) : null;

  const tags = parts[4] ? parseTags(parts[4]) : null;
  const description = parts[5] ? parts[5] : null;

  return { shortCode, fullName, commonName, zones, tags, description };
}

function parseZones(raw: string): ParsedZoneRef[] {
  return raw
    .split("+")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseZoneRef);
}

function parseZoneRef(segment: string): ParsedZoneRef {
  const m = segment.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const name = m[1].trim();
    return { code: m[2].trim(), name: name || null };
  }
  return { code: segment, name: null };
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

export interface ResolvedPlant {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCodes: string[];
  tags: string[];
  description: string | null;
}

export interface ResolveResult {
  plant: ResolvedPlant;
  /** Zone records that should be created or renamed in the registry. */
  zoneUpserts: Zone[];
}

/**
 * Inherit missing fields from the most recent prior entry with a matching
 * shortCode. Auto-register any new zoneCodes referenced by the caption,
 * and apply any new zone names provided.
 *
 * Throws if shortCode is brand new and `fullName` or zones are missing.
 */
export function resolveFields(
  parsed: ParsedCaption,
  existing: PlantEntry[],
  zones: Zone[]
): ResolveResult {
  const priorPlant = existing.find((p) => p.shortCode === parsed.shortCode);

  let zoneCodes: string[];
  const zoneUpserts: Zone[] = [];

  if (parsed.zones && parsed.zones.length > 0) {
    zoneCodes = parsed.zones.map((z) => z.code);
    for (const z of parsed.zones) {
      const existingZone = zones.find((existing) => existing.code === z.code);
      if (!existingZone) {
        zoneUpserts.push({ code: z.code, name: z.name });
      } else if (z.name && z.name !== existingZone.name) {
        zoneUpserts.push({ code: z.code, name: z.name });
      }
    }
  } else if (priorPlant) {
    zoneCodes = priorPlant.zoneCodes;
  } else {
    throw new Error(
      `New plant "${parsed.shortCode}" needs a zone. Use: shortCode // fullName // commonName // Zone Name (zoneCode)`
    );
  }

  if (zoneCodes.length === 0) {
    throw new Error(`Plant "${parsed.shortCode}" must belong to at least one zone.`);
  }

  const fullName = parsed.fullName ?? priorPlant?.fullName ?? null;
  const commonName = parsed.commonName ?? priorPlant?.commonName ?? null;
  const tags = parsed.tags ?? priorPlant?.tags ?? [];

  if (!priorPlant && !fullName) {
    throw new Error(
      `New shortCode "${parsed.shortCode}" needs a fullName. Use: shortCode // Genus species 'Variety' // Common Name // Zone (code)`
    );
  }

  return {
    plant: {
      shortCode: parsed.shortCode,
      fullName,
      commonName,
      zoneCodes,
      tags,
      description: parsed.description,
    },
    zoneUpserts,
  };
}
