import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { LEAF_RADIUS } from "../TreeView/types";

// Same palette as the food web, so a type keeps its colour across both views.
export const TYPE_COLORS = [
  "var(--color-accent)",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#f87171",
];

export const NODE_R = LEAF_RADIUS;

export const CANVAS_W = 1600;
export const CANVAS_H = 1000;

export interface Pt {
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/**
 * One-shot force layout over the canvas node set. Seeds from a persistent
 * position cache (keyed by code) so adding/removing a node relaxes the existing
 * arrangement instead of reshuffling it — mirroring the food web's behaviour.
 */
export function runLayout(
  codes: string[],
  edges: Array<[string, string]>,
  cache: Map<string, Pt>,
): Map<string, Pt> {
  const positions = new Map<string, Pt>();
  if (codes.length === 0) return positions;
  if (codes.length === 1) {
    const p = cache.get(codes[0]) ?? { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    positions.set(codes[0], p);
    cache.set(codes[0], p);
    return positions;
  }

  let cached = 0;
  const nodes: SimNode[] = codes.map((id, i) => {
    const c = cache.get(id);
    if (c) {
      cached++;
      return { id, x: c.x, y: c.y };
    }
    const a = (i / codes.length) * Math.PI * 2;
    return {
      id,
      x: CANVAS_W / 2 + Math.cos(a) * 260,
      y: CANVAS_H / 2 + Math.sin(a) * 260,
    };
  });
  const has = new Set(codes);
  const links = edges
    .filter(([a, b]) => has.has(a) && has.has(b))
    .map(([source, target]) => ({ source, target }));

  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((d) => d.id)
        .distance(240)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-2600).distanceMax(1200))
    .force("collide", forceCollide(NODE_R * 3 + 40).strength(1))
    .force("x", forceX(CANVAS_W / 2).strength(0.05))
    .force("y", forceY(CANVAS_H / 2).strength(0.05))
    .stop();

  const mostlyCached = cached >= codes.length * 0.5;
  const ticks = mostlyCached ? 120 : 300;
  sim.alpha(mostlyCached ? 0.3 : 1).alphaDecay(mostlyCached ? 0.05 : 0.0228);
  for (let i = 0; i < ticks; i++) sim.tick();

  for (const n of nodes) {
    const p = { x: n.x ?? 0, y: n.y ?? 0 };
    positions.set(n.id, p);
    cache.set(n.id, p);
  }
  return positions;
}

export interface EdgeGeometry {
  /** Quadratic path from source to target, bowed out for parallel edges. */
  path: string;
  /** Midpoint of the bow, where the type label sits. */
  labelX: number;
  labelY: number;
  /** Label rotation in degrees, clamped so text never reads upside-down. */
  angle: number;
}

/**
 * Geometry for one edge in a bundle of `total` parallel edges. `idx` fans the
 * bundle symmetrically around the straight line; `reverse` swaps the endpoints
 * so a backwards relationship still draws its arrowhead at the visual target.
 */
export function edgeGeometry(
  a: Pt,
  b: Pt,
  idx: number,
  total: number,
  reverse: boolean,
): EdgeGeometry {
  const x1 = reverse ? b.x : a.x;
  const y1 = reverse ? b.y : a.y;
  const x2 = reverse ? a.x : b.x;
  const y2 = reverse ? a.y : b.y;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(0.01, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const offset = (idx - (total - 1) / 2) * 60;
  const cx = mx + nx * offset * 2;
  const cy = my + ny * offset * 2;

  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle < -90) angle += 180;

  return {
    path: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
    labelX: mx + nx * offset,
    labelY: my + ny * offset,
    angle,
  };
}

/** Nearest node to `p` within the grab radius, or null. */
export function nodeAt(p: Pt, positions: Map<string, Pt>): string | null {
  let best: string | null = null;
  let bestD = NODE_R + 10;
  for (const [code, pos] of positions) {
    const d = Math.hypot(pos.x - p.x, pos.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}
