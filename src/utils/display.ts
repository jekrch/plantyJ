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
  if (plant.commonName) return plant.commonName;
  if (plant.fullName) return plant.fullName;
  if (isUnidentified(plant)) return "Unidentified";
  return plant.shortCode;
}
