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

export interface OrganismRecord {
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

// Runtime view: a pic joined with its organism record (lookup by shortCode).
// Components consume this merged shape.
export interface Organism extends PicRecord {
  fullName: string | null;
  commonName: string | null;
  variety?: string | null;
}

export interface Gallery {
  pics: PicRecord[];
  organisms: OrganismRecord[];
  zones: Zone[];
}

export interface Annotation {
  shortCode: string;
  zoneCode: string | null;  // null = organism-level; string = organism+zone level
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

export type AIVerdict = "GOOD" | "BAD" | "MIXED";

export interface AIAnalysis {
  shortCode: string;
  zoneCode: string;
  verdict: AIVerdict;
  analysis: string;
  references: string[];
  created: string;
}

// Direction override on a Relationship instance.
// Omitted = use the type's default (directional types go from→to; non-directional are undirected).
// "f" = explicit forward (from→to). "b" = backward (to→from). "u" = force undirected.
// The literal "none" is intentionally unused — absent = default.
export type RelationshipDirection = "f" | "b" | "u";

export interface RelationshipType {
  id: string;
  name: string;
  description: string;
  directional: boolean;
}

export interface Relationship {
  id: number;
  type: string;
  from: string;
  to: string;
  direction?: RelationshipDirection;
}

export interface RelationshipsFile {
  types: RelationshipType[];
  relationships: Relationship[];
}
