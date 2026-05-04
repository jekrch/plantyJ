import type { Plant } from "../types";

let seq = 0;

export function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    seq: ++seq,
    id: `plant-${seq}`,
    shortCode: "test",
    zoneCode: "Z1",
    tags: [],
    description: null,
    image: "img.jpg",
    postedBy: "user",
    addedAt: "2024-01-01T00:00:00Z",
    width: 100,
    height: 100,
    fullName: null,
    commonName: null,
    ...overrides,
  };
}
