import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { Organism, Relationship } from "../../types";
import { LEAF_RADIUS } from "../TreeView/types";

export const TYPE_COLORS = [
  "var(--color-accent)",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#f87171",
];

/** Fixed virtual canvas. Smaller than the settled graph's bounding box, so the
 *  pan/zoom hook opens in a naturally zoomed-in state. */
export const CANVAS_W = 1600;
export const CANVAS_H = 1000;

export interface Pt {
  x: number;
  y: number;
}

export interface PositionedNode {
  code: string;
  label: string;
  subLabel: string | null;
  x: number;
  y: number;
  organism: Organism | undefined;
  isAnimal: boolean;
}

export interface PositionedEdge {
  rel: Relationship;
  typeName: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  dir: "fwd" | "bwd" | "u";
  groupIndex: number;
  groupTotal: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

// Force-directed layout via d3-force. A persistent position cache (keyed by
// node code, owned by the component) seeds the simulation so toggling a
// relationship filter relaxes the existing layout instead of reshuffling it.
export function layoutGraph(
  nodes: string[],
  edges: Array<[string, string]>,
  posCache: Map<string, Pt>,
): { positions: Map<string, Pt>; width: number; height: number } {
  const positions = new Map<string, Pt>();
  if (nodes.length === 0) return { positions, width: CANVAS_W, height: CANVAS_H };

  if (nodes.length === 1) {
    const center = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    positions.set(nodes[0], center);
    posCache.set(nodes[0], center);
    return { positions, width: CANVAS_W, height: CANVAS_H };
  }

  const k = 240; // Ideal link distance (gives edge labels breathing room)
  const minDistance = LEAF_RADIUS * 4 + 60; // Strict anti-collision padding

  // Seed from cache when we've placed this node before; otherwise a
  // deterministic circle (no Math.random — layout stays reproducible).
  let cachedCount = 0;
  const simNodes: SimNode[] = nodes.map((id, i) => {
    const cached = posCache.get(id);
    if (cached) {
      cachedCount++;
      return { id, x: cached.x, y: cached.y };
    }
    const angle = (i / nodes.length) * Math.PI * 2;
    return { id, x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 };
  });
  const hasNode = new Set(nodes);
  const simLinks = edges
    .filter(([a, b]) => hasNode.has(a) && hasNode.has(b))
    .map(([source, target]) => ({ source, target }));

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(k * 1.3)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-3800).distanceMax(1400))
    .force("collide", forceCollide(minDistance).strength(1))
    .force("x", forceX(0).strength(0.03))
    .force("y", forceY(0).strength(0.03))
    .stop();

  // Mostly-cached graph => a filter toggle: relax gently so existing nodes
  // barely move. Fresh graph => full settle from the seed.
  const mostlyCached = cachedCount >= nodes.length * 0.5;
  if (mostlyCached) {
    sim.alpha(0.3).alphaDecay(0.05);
    for (let i = 0; i < 120; i++) sim.tick();
  } else {
    sim.alpha(1).alphaDecay(0.0228);
    for (let i = 0; i < 300; i++) sim.tick();
  }

  for (const n of simNodes) {
    const p = { x: n.x ?? 0, y: n.y ?? 0 };
    positions.set(n.id, p);
    posCache.set(n.id, p);
  }

  const focus = focalPoint(nodes, edges, positions);

  // Shift the graph cluster so our focal point centers in our viewport
  const offsetX = CANVAS_W / 2 - focus.x;
  const offsetY = CANVAS_H / 2 - focus.y;

  positions.forEach((p) => {
    p.x += offsetX;
    p.y += offsetY;
  });

  return { positions, width: CANVAS_W, height: CANVAS_H };
}

/**
 * The point the view should centre on: the highest-degree node, since that's
 * the visual anchor of the densest cluster. Falls back to the centre of the
 * bounding box when the graph has no edges to rank nodes by.
 */
function focalPoint(
  nodes: string[],
  edges: Array<[string, string]>,
  positions: Map<string, Pt>,
): Pt {
  const degrees = new Map<string, number>();
  nodes.forEach((n) => degrees.set(n, 0));
  edges.forEach(([u, v]) => {
    degrees.set(u, (degrees.get(u) || 0) + 1);
    degrees.set(v, (degrees.get(v) || 0) + 1);
  });

  let densestNode = nodes[0];
  let maxDegree = -1;
  degrees.forEach((deg, n) => {
    if (deg > maxDegree) {
      maxDegree = deg;
      densestNode = n;
    }
  });

  const p = densestNode ? positions.get(densestNode) : undefined;
  if (p) return p;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  positions.forEach((q) => {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  });
  // Give a zero-width/height extent a nominal size so the midpoint is defined.
  if (maxX === minX) maxX += 10;
  if (maxY === minY) maxY += 10;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// Geometry for one rendered edge: the curved path plus where/how its type
// label sits. Pulled out of the render so the edge layer and the on-top
// label layer compute identical positions.
export function edgeGeometry(e: PositionedEdge) {
  const reverse = e.dir === "bwd";
  const x1 = reverse ? e.toX : e.fromX;
  const y1 = reverse ? e.toY : e.fromY;
  const x2 = reverse ? e.fromX : e.toX;
  const y2 = reverse ? e.fromY : e.toY;
  const directed = e.dir !== "u";

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  // The perpendicular is computed from the pair in a canonical order, so both
  // directions of the same pair fan to the same side and never overlap.
  const isFromSmaller = e.rel.from < e.rel.to;
  const normX1 = isFromSmaller ? e.fromX : e.toX;
  const normY1 = isFromSmaller ? e.fromY : e.toY;
  const normX2 = isFromSmaller ? e.toX : e.fromX;
  const normY2 = isFromSmaller ? e.toY : e.fromY;

  const baseDx = normX2 - normX1;
  const baseDy = normY2 - normY1;
  const baseLen = Math.max(0.01, Math.hypot(baseDx, baseDy));
  const nx = -baseDy / baseLen;
  const ny = baseDx / baseLen;

  const spread = 60;
  const offset = (e.groupIndex - (e.groupTotal - 1) / 2) * spread;

  const cx = midX + nx * (offset * 2);
  const cy = midY + ny * (offset * 2);

  const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  const textMidX = midX + nx * offset;
  const textMidY = midY + ny * offset;

  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle < -90) angle += 180;

  return { pathD, directed, textMidX, textMidY, angle };
}
