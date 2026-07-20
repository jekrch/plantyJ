const PIC_FIELDS = ["zoneCode", "tags", "description"] as const;
const PLANT_FIELDS = ["shortCode", "fullName", "commonName", "variety"] as const;
const UPDATABLE_FIELDS = [...PLANT_FIELDS, ...PIC_FIELDS] as const;

export type PicField = (typeof PIC_FIELDS)[number];
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export const UPDATABLE_FIELD_LIST = UPDATABLE_FIELDS;

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field);
}

/** Pic-level fields live on the pic row; the rest live on the plant record. */
export function isPicField(field: UpdatableField): field is PicField {
  return (PIC_FIELDS as readonly string[]).includes(field);
}

/** Comma-separated user input → trimmed, non-empty values. */
export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
