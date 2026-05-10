import { hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import type { Plant, Species } from "../../types";
import type { RawNode } from "../TreeView/types";
import { RANKS } from "../TreeView/types";

// Build a single-plant hierarchy that satisfies HierarchyPointNode<RawNode>,
// so NodeDetail can render its ancestry trail and act on the leaf plant.
// Positions are zeroed since we don't lay it out — the detail panel ignores them.
export function buildWebNode(
  plant: Plant,
  species: Species | undefined
): HierarchyPointNode<RawNode> {
  const root: RawNode = { name: "Tree of Life", rank: "root", children: [] };
  let cur = root;
  const tax = species?.taxonomy;
  if (tax) {
    for (const rank of RANKS) {
      const v = tax[rank];
      if (!v) continue;
      const child: RawNode = { name: v, rank, children: [] };
      cur.children = [child];
      cur = child;
    }
  }
  cur.shortCode = plant.shortCode;
  cur.plant = plant;
  cur.children = undefined;

  const h = hierarchy<RawNode>(root, (d) => d.children);
  h.each((n) => {
    (n as HierarchyPointNode<RawNode>).x = 0;
    (n as HierarchyPointNode<RawNode>).y = 0;
  });

  let leaf: typeof h = h;
  while (leaf.children && leaf.children[0]) leaf = leaf.children[0];
  return leaf as HierarchyPointNode<RawNode>;
}
