import type { NeighborMap } from "../adjacency";

// Configuration

/** Minimum filler dimension (px) along an axis to show a label on that edge. */
const MIN_LABEL_AXIS = 70;
/** Minimum filler dimension on the cross-axis so labels don't crowd. */
const MIN_CROSS_AXIS = 50;
/** Nominal leader run (px) — the gap a badge leaves for its own leader. */
const LEADER_RUN = 16;
/** A leader shorter than this doesn't read as a pointer; route it another way. */
const MIN_LEADER = 10;
/** Travel away from the badge before an elbow turns toward its edge (px). */
const ELBOW_VERT = 14;
/** How far into the badge footprint an elbow's turn sits (px). */
const ELBOW_INSET = 17;
/** Travel clear of the badge before a flanking leader turns toward its edge (px). */
const FLANK_RUN = 15;
/** Padding from the filler edge to the label (px). */
const EDGE_PAD = 8;
/**
 * Per-character advance used for bbox estimation. The badge font is Space Mono
 * (monospace, 0.6em advance) plus 0.02em letter-spacing => 8.68px at 14px. We
 * round up so the estimate is never narrower than the rendered badge — an
 * under-estimate would let two badges collide after passing the overlap test.
 */
const CHAR_W = 9;
/** Badge font size (px). */
export const FONT_SIZE = 14;
/** Badge horizontal padding (px). */
export const BADGE_PX = 8;
/** Badge vertical padding (px). */
export const BADGE_PY = 4;
/** Leader stroke width (px). */
export const STROKE_W = 2.5;
/** Badge height = font size + 2 * vertical padding. */
const BADGE_H = FONT_SIZE + BADGE_PY * 2;
/** Minimum gap between label bounding boxes (px). */
const MIN_GAP = 6;
/** Step size when sliding a label along its edge looking for a free slot (px). */
const SLIDE_STEP = 6;
/** Cap on slide positions considered per label, so the placement search stays cheap. */
const MAX_SLOTS = 11;
/**
 * Score weights. Each dominates the sum of everything below it, so the search
 * settles the questions in order: keep as many names as possible, then draw as
 * many of their leaders as possible, then avoid crossings, and only then keep
 * badges near their natural position.
 */
const KEEP_WEIGHT = 1e9;
const LEADER_WEIGHT = 1e5;
const CROSS_WEIGHT = 1e4;
/** Two strokes closer than this along their shared axis read as one line. */
const PARALLEL_NEAR = STROKE_W * 2;
/** Slack for the axis-aligned tests below. */
const EPS = 0.5;

// Types

export type Edge = "top" | "bottom" | "left" | "right";

const EDGE_ORDER: Edge[] = ["top", "bottom", "left", "right"];

/** Does a leader for this edge travel vertically to reach the border? */
const isVerticalLeader = (edge: Edge) => edge === "top" || edge === "bottom";

export interface Point {
  x: number;
  y: number;
}

/** One polyline running from the badge to the border by the edge it names. */
export interface Leader {
  edge: Edge;
  points: Point[];
}

export interface PlacedLabel {
  /** Neighbor label text; unique per filler, so it doubles as a React key. */
  name: string;
  displayName: string;
  /** Badge box in filler-local coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  leaders: Leader[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One neighbor name, and every edge of this filler it borders. */
interface LabelGroup {
  name: string;
  displayName: string;
  edges: Edge[];
  /** Estimated badge width — the same for every placement of this group. */
  badgeW: number;
  /**
   * Which flank each leader of an opposing pair leaves by. Derived from the
   * name so it holds still across relayouts, and varies from badge to badge.
   */
  flip: boolean;
}

/** A candidate position for one group, with its leaders already routed. */
interface Placement {
  box: Rect;
  leaders: Leader[];
  segments: Segment[];
  /** How many of the group's edges this placement actually points at. */
  drawn: number;
  /** Distance from the group's preferred position, in px. */
  spread: number;
}

// Name helpers

function shortLabel(text: string): string {
  return text.length > 20 ? text.slice(0, 18) + "…" : text;
}

function estimateBadgeWidth(text: string): number {
  return text.length * CHAR_W + BADGE_PX * 2;
}

/** A stable bit per name, so its leaders keep the same handedness. */
function handedness(name: string): boolean {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return (hash & 1) === 1;
}

// Grouping

/**
 * One group per neighbor name, carrying every edge it appears on. A plant
 * bordering the filler on two sides gets a single badge with a leader to each —
 * repeating the name would read as two different neighbors.
 */
function buildGroups(neighbors: NeighborMap, fillerW: number, fillerH: number): LabelGroup[] {
  const byName = new Map<string, Edge[]>();

  for (const edge of EDGE_ORDER) {
    const organism = neighbors[edge];
    const name = organism && (organism.commonName ?? organism.fullName ?? organism.shortCode);
    if (!name) continue;

    // An edge only earns a leader if the filler is big enough to carry one.
    const vertical = isVerticalLeader(edge);
    const primaryAxis = vertical ? fillerW : fillerH;
    const crossAxis = vertical ? fillerH : fillerW;
    if (primaryAxis < MIN_LABEL_AXIS || crossAxis < MIN_CROSS_AXIS) continue;

    const edges = byName.get(name);
    if (edges) edges.push(edge);
    else byName.set(name, [edge]);
  }

  const groups: LabelGroup[] = [];
  for (const [name, edges] of byName) {
    const displayName = shortLabel(name);
    const badgeW = estimateBadgeWidth(displayName);
    // A badge that cannot fit between the edges at all is never placeable.
    if (badgeW > fillerW - EDGE_PAD * 2 || BADGE_H > fillerH - EDGE_PAD * 2) continue;
    groups.push({ name, displayName, edges, badgeW, flip: handedness(name) });
  }
  return groups;
}

/**
 * Where a badge sits when nothing else is competing: offset by one leader run
 * from each edge it names, centered on any axis it doesn't name, and always
 * inside the filler's padding.
 */
function naturalBox(edges: Edge[], w: number, fillerW: number, fillerH: number): Rect {
  const h = BADGE_H;
  const maxX = fillerW - EDGE_PAD - w;
  const maxY = fillerH - EDGE_PAD - h;

  const wantsLeft = edges.includes("left");
  const wantsRight = edges.includes("right");
  const wantsTop = edges.includes("top");
  const wantsBottom = edges.includes("bottom");

  let x: number;
  if (wantsLeft && !wantsRight) x = EDGE_PAD + LEADER_RUN;
  else if (wantsRight && !wantsLeft) x = maxX - LEADER_RUN;
  else x = (fillerW - w) / 2;

  let y: number;
  if (wantsTop && !wantsBottom) y = EDGE_PAD + LEADER_RUN;
  else if (wantsBottom && !wantsTop) y = maxY - LEADER_RUN;
  else y = (fillerH - h) / 2;

  return {
    x: clamp(x, EDGE_PAD, maxX),
    y: clamp(y, EDGE_PAD, maxY),
    w,
    h,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// Leader routing

/**
 * Routes one leader from `box` out to the border on `edge`, or null when there
 * is no room for a run that reads as a pointer.
 *
 * The direct route is a single stroke leaving the side of the badge that faces
 * the edge. When the badge is pressed up against that edge there is no room for
 * one, so the leader steps clear of the badge first and makes its run there —
 * the travel still starts inside the badge's own footprint, so it reads as
 * pointing outward even with no space to point into.
 */
function routeLeader(edge: Edge, box: Rect, fillerW: number, fillerH: number): Leader | null {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const inset = Math.min(ELBOW_INSET, w);

  if (edge === "top" || edge === "bottom") {
    // A badge only loses its vertical run on a filler too short to hold the
    // badge plus one, and stepping aside there would need width the elbow has
    // no reason to expect — so a short stub is the honest thing to draw.
    const target = edge === "top" ? EDGE_PAD : fillerH - EDGE_PAD;
    const start = edge === "top" ? y : y + h;
    if (Math.abs(start - target) < EPS) return null;
    return {
      edge,
      points: [
        { x: cx, y: start },
        { x: cx, y: target },
      ],
    };
  }

  const target = edge === "left" ? EDGE_PAD : fillerW - EDGE_PAD;
  const side = edge === "left" ? x : x + w;

  if (Math.abs(side - target) >= MIN_LEADER) {
    return {
      edge,
      points: [
        { x: side, y: cy },
        { x: target, y: cy },
      ],
    };
  }

  // Elbow: drop below the badge (or rise above it) and run toward the edge.
  const turnX = edge === "left" ? x + inset : x + w - inset;
  const below = y + h + ELBOW_VERT;
  const above = y - ELBOW_VERT;
  const turnY = below <= fillerH - EDGE_PAD ? below : above >= EDGE_PAD ? above : null;
  if (turnY === null) return null;

  return {
    edge,
    points: [
      { x: turnX, y: turnY < y ? y : y + h },
      { x: turnX, y: turnY },
      { x: target, y: turnY },
    ],
  };
}

/**
 * The two edges of an opposing pair (top+bottom, or left+right), or null when
 * the subset isn't one.
 */
function opposingAxis(subset: Edge[]): "vertical" | "horizontal" | null {
  if (subset.length !== 2) return null;
  const vertical = subset.filter(isVerticalLeader).length;
  if (vertical === 2) return "vertical";
  if (vertical === 0) return "horizontal";
  return null;
}

/**
 * Routes an opposing pair out of the badge's flanks rather than straight
 * through it. Direct routes for both would meet as one unbroken stroke with the
 * name parked in the middle of it, reading as a line the badge interrupts
 * rather than as two pointers. Leaving from opposite flanks and turning toward
 * each neighbor keeps them legible as a pair, and gives the wall some variety
 * against the plainer single-edge labels.
 *
 * Returns null when either leader lacks room to step clear, since one flanked
 * and one direct leader looks like a mistake rather than a choice — the caller
 * then routes both directly.
 */
function routeFlanked(
  axis: "vertical" | "horizontal",
  box: Rect,
  fillerW: number,
  fillerH: number,
  flip: boolean,
): Leader[] | null {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const leaders: Leader[] = [];

  if (axis === "vertical") {
    for (const edge of ["top", "bottom"] as const) {
      // The two leaders take opposite flanks, so their runs out of the badge
      // never share a lane.
      const viaLeft = (edge === "top") !== flip;
      const exitX = viaLeft ? x : x + w;
      const turnX = viaLeft ? x - FLANK_RUN : x + w + FLANK_RUN;
      const target = edge === "top" ? EDGE_PAD : fillerH - EDGE_PAD;
      if (turnX < EDGE_PAD || turnX > fillerW - EDGE_PAD) return null;
      if (Math.abs(cy - target) < MIN_LEADER) return null;
      leaders.push({
        edge,
        points: [
          { x: exitX, y: cy },
          { x: turnX, y: cy },
          { x: turnX, y: target },
        ],
      });
    }
    return leaders;
  }

  for (const edge of ["left", "right"] as const) {
    const viaTop = (edge === "left") !== flip;
    const exitY = viaTop ? y : y + h;
    const turnY = viaTop ? y - FLANK_RUN : y + h + FLANK_RUN;
    const target = edge === "left" ? EDGE_PAD : fillerW - EDGE_PAD;
    if (turnY < EDGE_PAD || turnY > fillerH - EDGE_PAD) return null;
    if (Math.abs(cx - target) < MIN_LEADER) return null;
    leaders.push({
      edge,
      points: [
        { x: cx, y: exitY },
        { x: cx, y: turnY },
        { x: target, y: turnY },
      ],
    });
  }
  return leaders;
}

/** Every leader for one badge position, flanking an opposing pair when it fits. */
function routeAll(
  subset: Edge[],
  box: Rect,
  fillerW: number,
  fillerH: number,
  flip: boolean,
): Leader[] {
  const axis = opposingAxis(subset);
  if (axis) {
    const flanked = routeFlanked(axis, box, fillerW, fillerH, flip);
    if (flanked) return flanked;
  }

  const leaders: Leader[] = [];
  for (const edge of subset) {
    const leader = routeLeader(edge, box, fillerW, fillerH);
    if (leader) leaders.push(leader);
  }
  return leaders;
}

function toSegments(leaders: Leader[]): Segment[] {
  const segments: Segment[] = [];
  for (const leader of leaders) {
    for (let i = 1; i < leader.points.length; i++) {
      const a = leader.points[i - 1];
      const b = leader.points[i];
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  return segments;
}

// Crossing detection

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + MIN_GAP &&
    a.x + a.w + MIN_GAP > b.x &&
    a.y < b.y + b.h + MIN_GAP &&
    a.y + a.h + MIN_GAP > b.y
  );
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.max(a0, a1) >= Math.min(b0, b1) && Math.min(a0, a1) <= Math.max(b0, b1);
}

function within(v: number, a: number, b: number): boolean {
  return v >= Math.min(a, b) - EPS && v <= Math.max(a, b) + EPS;
}

/** Every leader stroke is axis-aligned, so crossing reduces to three cases. */
function segmentsCross(a: Segment, b: Segment): boolean {
  const aHoriz = Math.abs(a.y1 - a.y2) < EPS;
  const bHoriz = Math.abs(b.y1 - b.y2) < EPS;

  if (aHoriz !== bHoriz) {
    const h = aHoriz ? a : b;
    const v = aHoriz ? b : a;
    return within(v.x1, h.x1, h.x2) && within(h.y1, v.y1, v.y2);
  }
  // Parallel strokes don't cross, but ones running along each other are just as
  // unreadable, so they count the same.
  if (aHoriz) {
    return Math.abs(a.y1 - b.y1) < PARALLEL_NEAR && spansOverlap(a.x1, a.x2, b.x1, b.x2);
  }
  return Math.abs(a.x1 - b.x1) < PARALLEL_NEAR && spansOverlap(a.y1, a.y2, b.y1, b.y2);
}

/** An axis-aligned stroke is degenerate on one axis, so overlapping the box on
 *  both axes is the same as running through it. */
function segmentHitsRect(s: Segment, r: Rect): boolean {
  return spansOverlap(s.x1, s.x2, r.x, r.x + r.w) && spansOverlap(s.y1, s.y2, r.y, r.y + r.h);
}

/** Visual conflicts between two placed labels: crossed strokes, and strokes
 *  driven through the other label's badge. */
function conflicts(a: Placement, b: Placement): number {
  let count = 0;
  for (const sa of a.segments) {
    for (const sb of b.segments) {
      if (segmentsCross(sa, sb)) count++;
    }
    if (segmentHitsRect(sa, b.box)) count++;
  }
  for (const sb of b.segments) {
    if (segmentHitsRect(sb, a.box)) count++;
  }
  return count;
}

// Placement search

/**
 * Offsets to try along a label's axis, nearest-to-preferred first, all of them
 * inside [min, max]. Returns empty when the label is too big for the run, which
 * is the caller's signal to drop it.
 */
function slideCandidates(preferred: number, min: number, max: number): number[] {
  if (max < min) return [];

  const start = clamp(preferred, min, max);
  const slots = new Set([start, min, max]);
  // Widen the step on long edges rather than emitting dozens of near-identical
  // slots — the search below is exponential in the slot count.
  const step = Math.max(SLIDE_STEP, (max - min) / (MAX_SLOTS - 1));

  for (let d = step; d <= max - min; d += step) {
    if (start - d >= min) slots.add(start - d);
    if (start + d <= max) slots.add(start + d);
  }

  return [...slots].sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
}

/**
 * Edge subsets a group may fall back to, most informative first. A badge only
 * slides along an axis it isn't pointing on — sliding toward an edge it names
 * would leave that leader nowhere to go — so a neighbor bordering the filler on
 * two axes is pinned to one spot. When that spot is taken, giving up a leader
 * frees an axis to slide along, which beats giving up the name entirely.
 */
function edgeVariants(edges: Edge[]): Edge[][] {
  if (edges.length === 1) return [edges];

  const seen = new Set<string>();
  const variants: Edge[][] = [];
  const add = (subset: Edge[]) => {
    if (subset.length === 0) return;
    const key = subset.join("|");
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(subset);
  };

  add(edges);
  add(edges.filter(isVerticalLeader));
  add(edges.filter((e) => !isVerticalLeader(e)));
  for (const edge of edges) add([edge]);
  return variants;
}

/**
 * Positions to build placements around. The natural box reserves a leader run
 * between the badge and the edge it names; on a filler too cramped to spare
 * that run, a badge pressed flush to the edge still reads, because the elbow
 * route makes its travel inside the badge's own footprint. Offering both lets
 * the search spend the 16px only where it is free.
 */
function anchorsFor(subset: Edge[], natural: Rect, fillerW: number): Rect[] {
  const anchors = [natural];
  const flushX =
    subset.length === 1 && subset[0] === "left"
      ? EDGE_PAD
      : subset.length === 1 && subset[0] === "right"
        ? fillerW - EDGE_PAD - natural.w
        : null;
  if (flushX !== null && Math.abs(flushX - natural.x) > EPS) {
    anchors.push({ ...natural, x: flushX });
  }
  return anchors;
}

function buildPlacements(group: LabelGroup, fillerW: number, fillerH: number): Placement[] {
  const placements: Placement[] = [];

  for (const subset of edgeVariants(group.edges)) {
    const natural = naturalBox(subset, group.badgeW, fillerW, fillerH);
    const slideX = !subset.some((e) => !isVerticalLeader(e));
    const slideY = !subset.some(isVerticalLeader);

    for (const anchor of anchorsFor(subset, natural, fillerW)) {
      const xs = slideX
        ? slideCandidates(anchor.x, EDGE_PAD, fillerW - EDGE_PAD - anchor.w)
        : [anchor.x];
      const ys = slideY
        ? slideCandidates(anchor.y, EDGE_PAD, fillerH - EDGE_PAD - anchor.h)
        : [anchor.y];

      for (const y of ys) {
        for (const x of xs) {
          const box = { x, y, w: anchor.w, h: anchor.h };
          const leaders = routeAll(subset, box, fillerW, fillerH, group.flip);
          // A badge that points at nothing names no neighbor in particular.
          if (leaders.length === 0) continue;
          placements.push({
            box,
            leaders,
            segments: toSegments(leaders),
            drawn: leaders.length,
            spread: Math.abs(x - natural.x) + Math.abs(y - natural.y),
          });
        }
      }
    }
  }

  // Fullest leader set first, nearest-to-natural within it, so the common case
  // is the first branch tried and the search's bound prunes the rest of the
  // tree immediately.
  return placements.sort((a, b) => b.drawn - a.drawn || a.spread - b.spread);
}

/**
 * Chooses positions for the whole label set at once, maximizing how many names
 * survive, then how many of their leaders can be drawn, then how few strokes
 * cross, and only then keeping each badge near its natural position.
 *
 * Solving globally rather than greedily is what lets a top and bottom label
 * slide off-center to open a lane for a left or right label — placing them
 * centered first would strand the side labels with nowhere to go. A label with
 * no collision-free slot is dropped rather than drawn over a neighbor.
 *
 * Search is depth-first over at most four labels with a handful of slots each,
 * pruned whenever a partial layout already collides or cannot beat the best
 * solution so far.
 */
function resolveLayout(groups: LabelGroup[], fillerW: number, fillerH: number): PlacedLabel[] {
  const options = groups.map((g) => buildPlacements(g, fillerW, fillerH));
  // Leaders still up for grabs from `index` on, for the bound below.
  const leadersAhead = new Array(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--) {
    leadersAhead[i] = leadersAhead[i + 1] + groups[i].edges.length;
  }

  const chosen: { group: LabelGroup; placement: Placement }[] = [];
  let best: PlacedLabel[] = [];
  let bestScore = -Infinity;

  const score = (kept: number, leaders: number, crossings: number, spread: number) =>
    kept * KEEP_WEIGHT + leaders * LEADER_WEIGHT - crossings * CROSS_WEIGHT - spread;

  const search = (index: number, leaders: number, crossings: number, spread: number) => {
    if (index === groups.length) {
      const total = score(chosen.length, leaders, crossings, spread);
      if (total > bestScore) {
        bestScore = total;
        best = chosen.map(({ group, placement }) => ({
          name: group.name,
          displayName: group.displayName,
          ...placement.box,
          leaders: placement.leaders,
        }));
      }
      return;
    }

    // Upper bound: every remaining label placed and fully led, adding no
    // crossings and no extra displacement. Crossings only ever grow, so the
    // count so far is a valid floor.
    const bound = score(
      chosen.length + groups.length - index,
      leaders + leadersAhead[index],
      crossings,
      spread,
    );
    if (bound <= bestScore) return;

    const group = groups[index];
    for (const placement of options[index]) {
      if (chosen.some((c) => rectsOverlap(placement.box, c.placement.box))) continue;
      let added = 0;
      for (const c of chosen) added += conflicts(placement, c.placement);
      chosen.push({ group, placement });
      search(index + 1, leaders + placement.drawn, crossings + added, spread + placement.spread);
      chosen.pop();
    }

    // Dropping this label may leave room for the ones after it.
    search(index + 1, leaders, crossings, spread);
  };

  search(0, 0, 0, 0);
  return best;
}

// Entry point

export function layoutFillerLabels(
  neighbors: NeighborMap,
  fillerW: number,
  fillerH: number,
): PlacedLabel[] {
  if (fillerW <= 0 || fillerH <= 0) return [];
  const groups = buildGroups(neighbors, fillerW, fillerH);
  if (groups.length === 0) return [];
  return resolveLayout(groups, fillerW, fillerH);
}
