import type { Plant } from "../types";

const UNIDENTIFIED_PREFIX = "unid-";

export function isUnidentified(plant: { shortCode: string; fullName: string | null; commonName: string | null }): boolean {
  return (
    plant.shortCode.startsWith(UNIDENTIFIED_PREFIX) &&
    !plant.fullName &&
    !plant.commonName
  );
}

export function plantTitle(plant: Plant): string {
  let base: string;
  if (plant.commonName) base = plant.commonName;
  else if (plant.fullName) base = plant.fullName;
  else if (isUnidentified(plant)) return "Unidentified";
  else return plant.shortCode;
  if (plant.variety) return `${base} '${plant.variety}'`;
  return base;
}
