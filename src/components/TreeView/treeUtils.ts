import type { Organism, Species } from "../../types";
import type { RawNode, Rank } from "./types";
import { RANKS } from "./types";
import { organismTitle } from "../../utils/display";

export function speciesPicsFor(organisms: Organism[], shortCode: string): Organism[] {
  return organisms
    .filter((p) => p.shortCode === shortCode)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

export function buildTree(
  organisms: Organism[],
  speciesByShortCode: Map<string, Species>
): { root: RawNode; missing: Organism[] } {
  const repByShortCode = new Map<string, Organism>();
  for (const p of organisms) {
    const existing = repByShortCode.get(p.shortCode);
    if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
      repByShortCode.set(p.shortCode, p);
    }
  }

  const root: RawNode = { name: "Tree of Life", rank: "root", children: [] };
  const missing: Organism[] = [];

  for (const [shortCode, organism] of repByShortCode) {
    const sp = speciesByShortCode.get(shortCode);
    const tax = sp?.taxonomy;
    if (!tax) {
      missing.push(organism);
      continue;
    }
    const path: { name: string; rank: Rank }[] = [];
    for (const rank of RANKS) {
      const v = tax[rank];
      if (v) path.push({ name: v, rank });
    }
    if (path.length === 0) {
      missing.push(organism);
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
        if (!child.organism && !child.children) {
          child.shortCode = organism.shortCode;
          child.organism = organism;
        } else {
          // Two organisms share the same deepest taxonomy node — convert to an
          // internal node and give each organism its own variety leaf.
          if (child.organism) {
            const existing = child.organism;
            child.children = [{
              name: organismTitle(existing),
              rank: "variety" as Rank,
              shortCode: existing.shortCode,
              organism: existing,
            }];
            child.shortCode = undefined;
            child.organism = undefined;
          }
          child.children!.push({
            name: organismTitle(organism),
            rank: "variety" as Rank,
            shortCode: organism.shortCode,
            organism: organism,
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
