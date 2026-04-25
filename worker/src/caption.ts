import type { ParsedCaption, ParsedZoneRef, PlantEntry, Zone } from "./types";

/**
 * Parse a Telegram caption into structured plant metadata.
 *
 * Format (// delimited):
 *   shortCode // fullName // commonName // zone // tags // description
 *
 * The zone segment is a single zone — either a bare code (`fb1`) or
 * `Display Name (zoneCode)` to declare the name. A picture is always taken
 * in exactly one zone; if a plant lives in multiple zones, post a separate
 * picture per zone.
 *
 * Examples:
 *   tmt-c // Solanum lycopersicum // Cherokee Purple // Front Bed 1 (fb1) // edible // first ripe
 *   tmt-c // // // fb1 // // sizing up nicely
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

export interface ResolvedPlant {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCode: string;
  tags: string[];
  description: string | null;
}

export interface ResolveResult {
  plant: ResolvedPlant;
  /** Zone records that should be created or renamed in the registry. */
  zoneUpserts: Zone[];
}

/**
 * Inherit missing fields from prior entries with a matching shortCode. The
 * zone is inherited from the most recent prior picture of the same plant
 * (PlantEntry list is newest-first). Auto-register a new zoneCode referenced
 * by the caption, and apply any new zone name provided.
 *
 * Throws if shortCode is brand new and `fullName` or zone is missing.
 */
export function resolveFields(
  parsed: ParsedCaption,
  existing: PlantEntry[],
  zones: Zone[]
): ResolveResult {
  const priorPlant = existing.find((p) => p.shortCode === parsed.shortCode);

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
  } else if (priorPlant) {
    zoneCode = priorPlant.zoneCode;
  } else {
    throw new Error(
      `New plant "${parsed.shortCode}" needs a zone. Use: shortCode // fullName // commonName // Zone Name (zoneCode)`
    );
  }

  if (!zoneCode) {
    throw new Error(`Plant "${parsed.shortCode}" must belong to a zone.`);
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
      zoneCode,
      tags,
      description: parsed.description,
    },
    zoneUpserts,
  };
}
