// Pure parsers for the text-command surface. Kept free of I/O so the tricky
// bits (selection lists, // -delimited targets) are directly testable.

export function parseConfirmIndices(text: string, max: number): number[] | "all" | "invalid" {
  const rest = text.slice("/confirm".length).trim();
  if (rest === "") return "all";
  const tokens = rest.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const n = parseInt(t, 10);
    if (isNaN(n) || String(n) !== t || n < 1 || n > max) return "invalid";
    if (!out.includes(n)) out.push(n);
  }
  return out.length === 0 ? "invalid" : out;
}

export type TagTarget =
  | { kind: "pic"; seq: number; tag: string }
  | { kind: "annotation"; shortCode: string; zoneCode: string | null; tag: string }
  | { kind: "invalid" };

export function parseTagCommand(rest: string): TagTarget {
  const parts = rest.split("//").map((s) => s.trim());

  if (parts.length === 1) {
    const spaceIdx = parts[0].indexOf(" ");
    if (spaceIdx === -1) return { kind: "invalid" };
    const first = parts[0].slice(0, spaceIdx).trim();
    const tag = parts[0].slice(spaceIdx + 1).trim();
    const seq = parseInt(first, 10);
    if (!isNaN(seq) && String(seq) === first) {
      return { kind: "pic", seq, tag };
    }
    return { kind: "annotation", shortCode: first, zoneCode: null, tag };
  }
  if (parts.length === 2) {
    return { kind: "annotation", shortCode: parts[0], zoneCode: null, tag: parts[1] };
  }
  if (parts.length === 3) {
    return { kind: "annotation", shortCode: parts[0], zoneCode: parts[1], tag: parts[2] };
  }
  return { kind: "invalid" };
}

export const TAG_USAGE = (verb: string) =>
  `Invalid format. Use:\n  /${verb} {seq} {tag}\n  /${verb} {shortCode} // {tag}\n  /${verb} {shortCode} // {zoneCode} // {tag}`;

// /remove and /restore toggle the `removed` flag on a plant+zone combo. Both
// take the same `{shortCode} // {zoneCode}` form — zoneCode is required because
// removal is always scoped to a specific plant+zone pairing.
export function parseComboCommand(rest: string): { shortCode: string; zoneCode: string } | null {
  const parts = rest
    .split("//")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length !== 2) return null;
  return { shortCode: parts[0], zoneCode: parts[1] };
}

export const COMBO_USAGE = (verb: string) =>
  `Invalid format. Use:\n  /${verb} {shortCode} // {zoneCode}`;
