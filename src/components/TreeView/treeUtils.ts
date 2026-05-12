import type { Plant, Species } from "../../types";
import type { RawNode, Rank } from "./types";
import { RANKS } from "./types";
import { plantTitle } from "../../utils/display";

export function speciesPicsFor(plants: Plant[], shortCode: string): Plant[] {
  return plants
    .filter((p) => p.shortCode === shortCode)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

export function buildTree(
  plants: Plant[],
  speciesByShortCode: Map<string, Species>
): { root: RawNode; missing: Plant[] } {
  const repByShortCode = new Map<string, Plant>();
  for (const p of plants) {
    const existing = repByShortCode.get(p.shortCode);
    if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
      repByShortCode.set(p.shortCode, p);
    }
  }

  const root: RawNode = { name: "Tree of Life", rank: "root", children: [] };
  const missing: Plant[] = [];

  for (const [shortCode, plant] of repByShortCode) {
    const sp = speciesByShortCode.get(shortCode);
    const tax = sp?.taxonomy;
    if (!tax) {
      missing.push(plant);
      continue;
    }
    const path: { name: string; rank: Rank }[] = [];
    for (const rank of RANKS) {
      const v = tax[rank];
      if (v) path.push({ name: v, rank });
    }
    if (path.length === 0) {
      missing.push(plant);
      continue;
    }

    let cur = root;
    path.forEach((seg, i) => {
      const isLeaf = i === path.length - 1;
      cur.children = cur.children ?? [];
      let child = cur.children.find((c) => c.name === seg.name);
      if (!child) {
        child = { name: seg.name, rank: seg.rank, children: isLeaf ? undefined : [] };
        cur.children.push(child);
      }
      if (isLeaf) {
        if (!child.plant && !child.children) {
          child.shortCode = plant.shortCode;
          child.plant = plant;
        } else {
          // Two plants share the same deepest taxonomy node — convert to an
          // internal node and give each plant its own variety leaf.
          if (child.plant) {
            const existing = child.plant;
            child.children = [{
              name: plantTitle(existing),
              rank: "variety" as Rank,
              shortCode: existing.shortCode,
              plant: existing,
            }];
            child.shortCode = undefined;
            child.plant = undefined;
          }
          child.children!.push({
            name: plantTitle(plant),
            rank: "variety" as Rank,
            shortCode: plant.shortCode,
            plant: plant,
          });
        }
      }
      cur = child;
    });
  }

  function sortRec(n: RawNode) {
    if (!n.children) return;
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of n.children) sortRec(c);
  }
  sortRec(root);

  return { root, missing };
}

export function linkPath(
  src: { x: number; y: number },
  dst: { x: number; y: number }
): string {
  const mx = (src.y + dst.y) / 2;
  return `M${src.y},${src.x} C${mx},${src.x} ${mx},${dst.x} ${dst.y},${dst.x}`;
}
