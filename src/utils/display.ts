import type { Organism } from "../types";

const UNIDENTIFIED_PREFIX = "unid-";

export function isUnidentified(organism: { shortCode: string; fullName: string | null; commonName: string | null }): boolean {
  return (
    organism.shortCode.startsWith(UNIDENTIFIED_PREFIX) &&
    !organism.fullName &&
    !organism.commonName
  );
}

export function organismTitle(organism: Organism): string {
  let base: string;
  if (organism.commonName) base = organism.commonName;
  else if (organism.fullName) base = organism.fullName;
  else if (isUnidentified(organism)) return "Unidentified";
  else return organism.shortCode;
  if (organism.variety) return `${base} '${organism.variety}'`;
  return base;
}
