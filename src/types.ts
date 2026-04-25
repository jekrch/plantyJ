export interface Plant {
  seq: number;
  id: string;
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
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

export interface Zone {
  code: string;
  name: string | null;
}

export interface Gallery {
  plants: Plant[];
  zones: Zone[];
}
