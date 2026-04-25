export interface Plant {
  seq: number;
  id: string;
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCode: string;
  zoneName: string | null;
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

export interface Gallery {
  plants: Plant[];
}
