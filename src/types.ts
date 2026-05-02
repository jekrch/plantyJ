export interface PicMetadata {
  id: string;
  phash: string;
  dominantColors: number[][];
}

export interface PicRecord {
  seq: number;
  id: string;
  shortCode: string;
  zoneCode: string;
  tags: string[];
  description: string | null;
  image: string;
  postedBy: string;
  addedAt: string;
  width: number;
  height: number;
  bioclipSpeciesId?: string | null;
  bioclipCommonName?: string | null;
  bioclipScore?: number | null;
  bioclipWikiUrl?: string | null;
  kind?: "plant" | "animal";
}

export interface PlantRecord {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  variety?: string | null;
}

export interface Zone {
  code: string;
  name: string | null;
}

export interface ZonePic {
  id: string;
  zoneCode: string;
  image: string;
  addedAt: string;
  postedBy: string;
  description: string | null;
}

// Runtime view: a pic joined with its plant record (lookup by shortCode).
// Components consume this merged shape.
export interface Plant extends PicRecord {
  fullName: string | null;
  commonName: string | null;
  variety?: string | null;
}

export interface Gallery {
  pics: PicRecord[];
  plants: PlantRecord[];
  zones: Zone[];
}

export interface Annotation {
  shortCode: string;
  zoneCode: string | null;  // null = plant-level; string = plant+zone level
  tags: string[];
  description: string | null;
}

export interface SpeciesTaxonomy {
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
  canonicalName: string | null;
}

export interface SpeciesReference {
  name: string;
  url: string;
}

export interface Species {
  id: string;
  fullName: string | null;
  commonName: string | null;
  description: string | null;
  vernacularNames: string[];
  taxonomy: SpeciesTaxonomy | null;
  nativeRange: string | null;
  references: SpeciesReference[];
  sources: string[];
}

export interface TaxaInfo {
  description: string;
  url: string;
}
