import type { ParsedCaption, PlantEntry } from "./types";

/**
 * Parse a Telegram caption into structured plant metadata.
 *
 * Format (// delimited):
 *   shortCode // fullName // commonName // zoneName (zoneCode) // tags // description
 *
 * Only `shortCode` is required. To declare a new zone with a code, use
 * `Display Name (zoneCode)`. If only a code is given (no parentheses), it
 * is treated as the zoneCode.
 *
 * Shorthand: `tmt-c // // // fb1 // // sizing up nicely`
 * Minimal:   `tmt-c`
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
  let zoneCode: string | null = null;
  let zoneName: string | null = null;
  if (zoneRaw) {
    const m = zoneRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m) {
      zoneName = m[1].trim() || null;
      zoneCode = m[2].trim();
    } else {
      zoneCode = zoneRaw;
    }
  }

  const tags = parts[4] ? parseTags(parts[4]) : null;
  const description = parts[5] ? parts[5] : null;

  return { shortCode, fullName, commonName, zoneCode, zoneName, tags, description };
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

/**
 * Inherit missing fields from the most recent prior entry with a matching
 * shortCode, and the most recent zone-defining entry for the zoneCode.
 *
 * Throws if shortCode is brand new and `fullName` is missing — without a
 * prior entry to inherit from, we have no way to fill it.
 */
export function resolveFields(
  parsed: ParsedCaption,
  existing: PlantEntry[]
): {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCode: string;
  zoneName: string | null;
  tags: string[];
  description: string | null;
} {
  const priorPlant = existing.find((p) => p.shortCode === parsed.shortCode);

  let zoneCode = parsed.zoneCode;
  let zoneName = parsed.zoneName;
  if (!zoneCode) {
    if (priorPlant) {
      zoneCode = priorPlant.zoneCode;
      zoneName = zoneName ?? priorPlant.zoneName;
    } else {
      throw new Error(
        `New plant "${parsed.shortCode}" needs a zone. Use: shortCode // fullName // commonName // Zone Name (zoneCode)`
      );
    }
  }

  if (!zoneName) {
    const priorZone = existing.find((p) => p.zoneCode === zoneCode && p.zoneName);
    if (priorZone) zoneName = priorZone.zoneName;
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
    shortCode: parsed.shortCode,
    fullName,
    commonName,
    zoneCode,
    zoneName,
    tags,
    description: parsed.description,
  };
}
