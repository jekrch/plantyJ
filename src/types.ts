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
  dominantColors: number[][];
  phash: string;
}

export interface PlantRecord {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
}

export interface Zone {
  code: string;
  name: string | null;
}

// Runtime view: a pic joined with its plant record (lookup by shortCode).
// Components consume this merged shape.
export interface Plant extends PicRecord {
  fullName: string | null;
  commonName: string | null;
}

export interface Gallery {
  pics: PicRecord[];
  plants: PlantRecord[];
  zones: Zone[];
}
