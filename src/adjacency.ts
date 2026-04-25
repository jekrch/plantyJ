import type { Plant } from "./types";


// Neighbor map — which panels border a filler on each edge

export interface NeighborMap {
  top?: Plant;
  bottom?: Plant;
  left?: Plant;
  right?: Plant;
}


// Placed-item shapes (mirrors MasonryGrid's types for the resolver)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedPlantLike extends Rect {
  kind: "panel";
  panel: Plant;
  /** Plant height must be derived externally (aspect ratio). */
}

interface PlacedFillerLike extends Rect {
  kind: "filler";
}

type PlacedItemLike = PlacedPlantLike | PlacedFillerLike;


// Edge overlap helpers

const EDGE_TOLERANCE = 6; // px — how close edges must be to count as adjacent

/** Do two ranges [a0,a1] and [b0,b1] overlap by at least `min` px? */
function rangeOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  min = 4
): boolean {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap >= min;
}


// Public resolver


/**
 * Given the full list of placed items and a function to compute panel
 * height (since PlacedPlant doesn't store `h` directly), returns a Map
 * from filler key → NeighborMap.
 *
 * `getPlantHeight` receives a Plant and the rendered width and should
 * return the pixel height of that panel card.
 */
export function resolveNeighbors(
  items: PlacedItemLike[],
  getPlantHeight: (panel: Plant, width: number) => number
): Map<string, NeighborMap> {
  // Build bounding rects for every item
  interface BoundedItem {
    kind: "panel" | "filler";
    key: string;
    panel?: Plant;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const bounded: BoundedItem[] = items.map((item) => {
    if (item.kind === "panel") {
      const p = item as PlacedPlantLike;
      return {
        kind: "panel",
        key: p.panel.id,
        panel: p.panel,
        x: p.x,
        y: p.y,
        w: p.w,
        h: getPlantHeight(p.panel, p.w),
      };
    }
    const f = item as PlacedFillerLike & { key: string };
    return {
      kind: "filler",
      key: (f as any).key ?? "",
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
    };
  });

  const panels = bounded.filter((b) => b.kind === "panel");
  const fillers = bounded.filter((b) => b.kind === "filler");

  const result = new Map<string, NeighborMap>();

  for (const filler of fillers) {
    const neighbors: NeighborMap = {};
    const fRight = filler.x + filler.w;
    const fBottom = filler.y + filler.h;

    for (const p of panels) {
      const pRight = p.x + p.w;
      const pBottom = p.y + p.h;

      // Top edge of filler ≈ bottom edge of panel
      if (
        !neighbors.top &&
        Math.abs(filler.y - pBottom) < EDGE_TOLERANCE &&
        rangeOverlap(filler.x, fRight, p.x, pRight)
      ) {
        neighbors.top = p.panel;
      }

      // Bottom edge of filler ≈ top edge of panel
      if (
        !neighbors.bottom &&
        Math.abs(fBottom - p.y) < EDGE_TOLERANCE &&
        rangeOverlap(filler.x, fRight, p.x, pRight)
      ) {
        neighbors.bottom = p.panel;
      }

      // Left edge of filler ≈ right edge of panel
      if (
        !neighbors.left &&
        Math.abs(filler.x - pRight) < EDGE_TOLERANCE &&
        rangeOverlap(filler.y, fBottom, p.y, pBottom)
      ) {
        neighbors.left = p.panel;
      }

      // Right edge of filler ≈ left edge of panel
      if (
        !neighbors.right &&
        Math.abs(fRight - p.x) < EDGE_TOLERANCE &&
        rangeOverlap(filler.y, fBottom, p.y, pBottom)
      ) {
        neighbors.right = p.panel;
      }
    }

    result.set(filler.key, neighbors);
  }

  return result;
}