import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import type { AIAnalysis, Annotation, Organism, Zone } from "../types";
import type { SortMode } from "../utils/sorting";
import { computeMonthMarkers } from "../utils/sorting";
import type { Filters } from "../utils/filtering";
import { removedComboKey } from "../utils/removed";
import OrganismCard from "./OrganismCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFiller";
import { buildStampPool, CORNER_RADIUS } from "./HatchFiller";
import type { FillerRect, FillerShape, StampDef } from "./HatchFiller";
import FooterRoots from "./FooterRoots";
import { resolveNeighbors } from "../adjacency";
import type { EdgeSpans } from "./fillerLabelLayout";
import type { NeighborMap } from "../adjacency";

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;
const WIDE_THRESHOLD = 1.4;
// Aspect ratio (w / h) of a month-section header tile in newest/oldest sort.
// Higher = shorter/smaller banner.
const MONTH_HEADER_ASPECT = 6.5;

/**
 * Which step of the load-in wave a card sits on: its column plus how far down
 * the page it is, so the wall assembles as a diagonal running out of the
 * top-left corner rather than all at once. Capped because the tail is dead
 * time — cards far below the fold are never seen arriving anyway.
 */
const STAGGER_BAND = 420;
const STAGGER_MAX = 5;

function staggerStep(x: number, y: number, colWidth: number) {
  const col = colWidth > 0 ? Math.round(x / (colWidth + GAP)) : 0;
  const down = Math.floor(y / STAGGER_BAND);
  return Math.min(col + down, STAGGER_MAX);
}

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

function getAspect(organism: Organism): number {
  if (organism.width && organism.height && organism.width > 0 && organism.height > 0) {
    return organism.width / organism.height;
  }
  return DEFAULT_ASPECT;
}

function isWide(organism: Organism): boolean {
  return !organism.noWide && getAspect(organism) >= WIDE_THRESHOLD;
}

interface PlacedOrganism {
  kind: "panel";
  organism: Organism;
  x: number;
  y: number;
  w: number;
}

interface PlacedFiller {
  kind: "filler";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  assignedStamp: StampDef;
  fillerIndex: number;
  neighbors: NeighborMap;
}

interface PlacedMonth {
  kind: "month";
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Adjacent fillers merged into one body, positioned at their bounding box. */
interface PlacedFillerGroup {
  kind: "fillerGroup";
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fillerIndex: number;
  shape: FillerShape;
}

type PlacedItem = PlacedOrganism | PlacedFiller | PlacedMonth | PlacedFillerGroup;

// How far two filler edges can drift from exactly one GAP apart and still
// count as touching, and how much edge they must share before merging. A
// sliver of shared edge would join them with a thin neck that reads as a
// mistake, so those stay separate.
const MERGE_TOLERANCE = 1;
const MIN_SHARED_EDGE = 24;

/**
 * The gap between two fillers that sit one GAP apart along either axis, if
 * they share enough edge to merge. The bridge reaches a corner radius into
 * each side so the rounded corners at the join are covered and the outer
 * edge runs straight across.
 */
function bridgeBetween(a: PlacedFiller, b: PlacedFiller): FillerRect | null {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];

  if (Math.abs(right.x - (left.x + left.w) - GAP) <= MERGE_TOLERANCE) {
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (bottom - top < MIN_SHARED_EDGE) return null;
    const x = left.x + left.w - CORNER_RADIUS;
    return { x, y: top, w: right.x + CORNER_RADIUS - x, h: bottom - top };
  }
  if (Math.abs(lower.y - (upper.y + upper.h) - GAP) <= MERGE_TOLERANCE) {
    const l = Math.max(a.x, b.x);
    const r = Math.min(a.x + a.w, b.x + b.w);
    if (r - l < MIN_SHARED_EDGE) return null;
    const y = upper.y + upper.h - CORNER_RADIUS;
    return { x: l, y, w: r - l, h: lower.y + CORNER_RADIUS - y };
  }
  return null;
}

/**
 * Where each neighbor actually borders a filler, in filler-local px. Inside a
 * merged body part of an edge can open onto the next filler rather than the
 * card named for it, so labels need to know which stretch to point at. Edges
 * bordered end to end are left out.
 */
function borderSpans(f: PlacedFiller, panelRects: Map<Organism, FillerRect>): EdgeSpans {
  const spans: EdgeSpans = {};
  for (const edge of ["top", "bottom", "left", "right"] as const) {
    const organism = f.neighbors[edge];
    const p = organism && panelRects.get(organism);
    if (!p) continue;
    const horizontal = edge === "top" || edge === "bottom";
    const [start, len] = horizontal ? [f.x, f.w] : [f.y, f.h];
    const [pStart, pLen] = horizontal ? [p.x, p.w] : [p.y, p.h];
    const a = Math.max(0, pStart - start);
    const b = Math.min(len, pStart + pLen - start);
    if (a > 0 || b < len) spans[edge] = [a, Math.max(a, b)];
  }
  return spans;
}

/**
 * Replace every run of touching fillers with a single body, so neighbors
 * share one continuous pattern instead of being split by the grid gap.
 * Lone fillers pass through unchanged.
 */
function mergeAdjacentFillers(items: PlacedItem[]): PlacedItem[] {
  const fillers = items.filter((i): i is PlacedFiller => i.kind === "filler");
  if (fillers.length < 2) return items;

  const parent = fillers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const bridges: { a: number; rect: FillerRect }[] = [];
  for (let i = 0; i < fillers.length; i++) {
    for (let j = i + 1; j < fillers.length; j++) {
      const rect = bridgeBetween(fillers[i], fillers[j]);
      if (!rect) continue;
      parent[find(j)] = find(i);
      bridges.push({ a: i, rect });
    }
  }
  if (bridges.length === 0) return items;

  const groups = new Map<number, number[]>();
  fillers.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  const panelRects = new Map<Organism, FillerRect>();
  for (const item of items) {
    if (item.kind !== "panel") continue;
    const { organism, x, y, w } = item;
    panelRects.set(organism, { x, y, w, h: getOrganismHeight(organism, w) });
  }

  const merged: PlacedFillerGroup[] = [];
  const absorbed = new Set<PlacedFiller>();
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const parts = members.map((i) => fillers[i]);
    parts.forEach((f) => absorbed.add(f));
    const x = Math.min(...parts.map((f) => f.x));
    const y = Math.min(...parts.map((f) => f.y));
    const w = Math.max(...parts.map((f) => f.x + f.w)) - x;
    const h = Math.max(...parts.map((f) => f.y + f.h)) - y;
    merged.push({
      kind: "fillerGroup",
      key: parts.map((f) => f.key).join("+"),
      x,
      y,
      w,
      h,
      fillerIndex: Math.min(...parts.map((f) => f.fillerIndex)),
      shape: {
        members: parts.map((f) => ({
          key: f.key,
          x: f.x - x,
          y: f.y - y,
          w: f.w,
          h: f.h,
          neighbors: f.neighbors,
          spans: borderSpans(f, panelRects),
        })),
        bridges: bridges
          .filter((b) => find(b.a) === root)
          .map(({ rect }) => ({ ...rect, x: rect.x - x, y: rect.y - y })),
      },
    });
  }

  return [...items.filter((i) => !(i.kind === "filler" && absorbed.has(i))), ...merged];
}

function assignStampsToFillers(fillers: PlacedFiller[]): void {
  const pool = buildStampPool();
  const poolSize = pool.length;
  for (let i = 0; i < fillers.length; i++) {
    fillers[i].assignedStamp = pool[i % poolSize];
    fillers[i].fillerIndex = i;
  }
}

function getOrganismHeight(organism: Organism, width: number): number {
  const aspect = getAspect(organism);
  return width / aspect;
}

function computeLayout(
  organisms: Organism[],
  colCount: number,
  containerWidth: number,
  initialHeights: number[],
  monthMarkers: Map<string, string>,
): { items: PlacedItem[]; totalHeight: number } {
  const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;
  const colX = (col: number) => col * (colWidth + GAP);
  const heights = [...initialHeights];
  const items: PlacedItem[] = [];

  const placeholder: StampDef = { type: "word", value: "" };
  const emptyNeighbors: NeighborMap = {};

  const shortestCol = () => {
    let target = 0;
    for (let i = 1; i < colCount; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    return target;
  };

  for (let idx = 0; idx < organisms.length; idx++) {
    const organism = organisms[idx];

    const monthLabel = monthMarkers.get(organism.id);
    if (monthLabel) {
      const col = shortestCol();
      const headerH = colWidth / MONTH_HEADER_ASPECT;
      items.push({
        kind: "month",
        key: `month-${organism.id}`,
        label: monthLabel,
        x: colX(col),
        y: heights[col],
        w: colWidth,
        h: headerH,
      });
      heights[col] += headerH + GAP;
    }

    const aspect = getAspect(organism);
    const wide = isWide(organism) && colCount >= 2;

    if (wide) {
      let bestStart = 0;
      let bestMaxH = Infinity;
      for (let s = 0; s <= colCount - 2; s++) {
        const maxH = Math.max(heights[s], heights[s + 1]);
        if (maxH < bestMaxH) {
          bestMaxH = maxH;
          bestStart = s;
        }
      }

      const col1 = bestStart;
      const col2 = bestStart + 1;
      const tallest = Math.max(heights[col1], heights[col2]);

      if (heights[col1] < tallest) {
        items.push({
          kind: "filler",
          key: `filler-${organism.id}-L`,
          x: colX(col1),
          y: heights[col1],
          w: colWidth,
          h: tallest - heights[col1],
          col: col1,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }
      if (heights[col2] < tallest) {
        items.push({
          kind: "filler",
          key: `filler-${organism.id}-R`,
          x: colX(col2),
          y: heights[col2],
          w: colWidth,
          h: tallest - heights[col2],
          col: col2,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }

      const spanW = colWidth * 2 + GAP;
      const organismH = spanW / aspect;
      items.push({
        kind: "panel",
        organism,
        x: colX(col1),
        y: tallest,
        w: spanW,
      });

      const newH = tallest + organismH + GAP;
      heights[col1] = newH;
      heights[col2] = newH;
    } else {
      let targetCol = 0;
      let minH = heights[0];
      for (let i = 1; i < colCount; i++) {
        if (heights[i] < minH) {
          minH = heights[i];
          targetCol = i;
        }
      }
      if (idx === 0) {
        const renderedH = colWidth / aspect;
        if (heights[0] - minH <= renderedH) {
          targetCol = 0;
        }
      }

      const organismH = colWidth / aspect;
      items.push({
        kind: "panel",
        organism,
        x: colX(targetCol),
        y: heights[targetCol],
        w: colWidth,
      });
      heights[targetCol] += organismH + GAP;
    }
  }

  const totalHeight = Math.max(...heights, 0);

  for (let col = 0; col < colCount; col++) {
    if (heights[col] < totalHeight) {
      const fillerH = totalHeight - heights[col];
      if (fillerH > GAP) {
        items.push({
          kind: "filler",
          key: `filler-end-${col}`,
          x: colX(col),
          y: heights[col],
          w: colWidth,
          h: fillerH - GAP,
          col,
          assignedStamp: placeholder,
          fillerIndex: 0,
          neighbors: emptyNeighbors,
        });
      }
    }
  }

  const fillers = items.filter((i): i is PlacedFiller => i.kind === "filler");
  assignStampsToFillers(fillers);

  const neighborMap = resolveNeighbors(
    items.map((item) => {
      if (item.kind === "panel") {
        return {
          kind: "panel" as const,
          panel: item.organism,
          x: item.x,
          y: item.y,
          w: item.w,
          h: getOrganismHeight(item.organism, item.w),
        };
      }
      return {
        kind: "filler" as const,
        key: item.key,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      };
    }),
    getOrganismHeight,
  );

  for (const filler of fillers) {
    const resolved = neighborMap.get(filler.key);
    if (resolved) filler.neighbors = resolved;
  }

  return { items, totalHeight };
}

interface MasonryGridProps {
  organisms: Organism[];
  allOrganisms: Organism[];
  zones: Zone[];
  /** `shortCode zoneCode` keys flagged removed — their cards get a removed badge. */
  removedSet?: Set<string>;
  annotations: Annotation[];
  aiAnalyses?: AIAnalysis[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onLayoutReady?: () => void;
  onOrganismPositions?: (positions: { organism: Organism; y: number; h: number }[]) => void;
  onOpenOrganism: (organism: Organism) => void;
}

export default function MasonryGrid({
  organisms,
  allOrganisms,
  zones,
  removedSet,
  annotations,
  aiAnalyses,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
  onLayoutReady,
  onOrganismPositions,
  onOpenOrganism,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);
  // The card currently revealing its details overlay. Tapping a card selects it;
  // tapping the selected card opens the viewer; tapping empty space clears it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const handleSelect = useCallback((o: Organism) => setSelectedId(o.id), []);

  const stampCacheRef = useRef<Map<string, { stamp: StampDef; fillerIndex: number }>>(new Map());

  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);

  const layout = useCallback(() => {
    if (!containerRef.current) return;
    const cc = getColumnCount();
    setColCount(cc);
    const containerWidth = containerRef.current.offsetWidth;
    const cw = (containerWidth - GAP * (cc - 1)) / cc;
    setColWidth(cw);

    const initialHeights = new Array(cc).fill(0);
    if (filterRef.current) {
      initialHeights[0] = filterRef.current.offsetHeight + GAP;
    }
    const lastCol = cc - 1;
    if (sortRef.current && lastCol !== 0) {
      initialHeights[lastCol] = sortRef.current.offsetHeight + GAP;
    }

    const monthMarkers = computeMonthMarkers(organisms, sortMode);
    const result = computeLayout(organisms, cc, containerWidth, initialHeights, monthMarkers);

    const fillers = result.items.filter((i): i is PlacedFiller => i.kind === "filler");
    for (const f of fillers) {
      const cached = stampCacheRef.current.get(f.key);
      if (cached) {
        f.assignedStamp = cached.stamp;
        f.fillerIndex = cached.fillerIndex;
      } else {
        stampCacheRef.current.set(f.key, {
          stamp: f.assignedStamp,
          fillerIndex: f.fillerIndex,
        });
      }
    }

    setPlaced(mergeAdjacentFillers(result.items));
    setTotalHeight(result.totalHeight);

    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("masonry-layout"));
    });
  }, [organisms, sortMode]);

  const prevOrganismIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = organisms.map((p) => p.id).join(",");
    if (ids !== prevOrganismIdsRef.current) {
      prevOrganismIdsRef.current = ids;
      stampCacheRef.current.clear();
    }
  }, [organisms]);

  // Before paint, not after: otherwise a freshly mounted wall paints one empty
  // frame and its cards arrive a frame later, missing the start state of the
  // load-in animation (`.wall-entering` in index.css).
  useLayoutEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  useEffect(() => {
    const observer = new ResizeObserver(() => layout());
    if (filterRef.current) observer.observe(filterRef.current);
    if (sortRef.current) observer.observe(sortRef.current);
    return () => observer.disconnect();
  }, [layout]);

  const hasCalledLayoutReady = useRef(false);
  useEffect(() => {
    if (placed.length === 0 || hasCalledLayoutReady.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (hasCalledLayoutReady.current) return;

        const allImgs = Array.from(document.querySelectorAll<HTMLImageElement>(".panel-item img"));

        const visiblePending = allImgs.filter((img) => {
          if (!img.src || img.src === window.location.href) return false;
          const rect = img.getBoundingClientRect();
          const inView =
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth;
          return inView && (!img.complete || img.naturalWidth === 0);
        });

        if (visiblePending.length === 0) {
          hasCalledLayoutReady.current = true;
          onLayoutReady?.();
          return;
        }

        const timeout = setTimeout(() => {
          if (!hasCalledLayoutReady.current) {
            hasCalledLayoutReady.current = true;
            onLayoutReady?.();
          }
        }, 5000);

        let remaining = visiblePending.length;
        const onSettle = () => {
          remaining -= 1;
          if (remaining <= 0) {
            clearTimeout(timeout);
            if (!hasCalledLayoutReady.current) {
              hasCalledLayoutReady.current = true;
              onLayoutReady?.();
            }
          }
        };

        visiblePending.forEach((img) => {
          img.addEventListener("load", onSettle, { once: true });
          img.addEventListener("error", onSettle, { once: true });
        });
      });
    });
  }, [placed, onLayoutReady]);

  // Clear the revealed details when the user taps/clicks outside any card.
  useEffect(() => {
    if (selectedId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".panel-item")) setSelectedId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectedId]);

  const lastColX = (colCount - 1) * (colWidth + GAP);

  useEffect(() => {
    if (!onOrganismPositions || placed.length === 0) return;
    const positions = placed
      .filter((item): item is PlacedOrganism => item.kind === "panel")
      .map((item) => ({
        organism: item.organism,
        y: item.y,
        h: getOrganismHeight(item.organism, item.w),
      }));
    onOrganismPositions(positions);
  }, [placed, onOrganismPositions]);

  // The guided tour points at a single card. Cards are absolutely positioned
  // and `placed` isn't in visual order, so pick the topmost one — anything
  // lower risks a spotlight that starts off-screen.
  const tourCardId = useMemo(() => {
    let top: PlacedOrganism | null = null;
    for (const item of placed) {
      if (item.kind !== "panel") continue;
      if (!top || item.y < top.y) top = item;
    }
    return top?.organism.id ?? null;
  }, [placed]);

  return (
    <>
      <div ref={containerRef} className="relative" style={{ height: `${totalHeight}px` }}>
        <div
          ref={filterRef}
          className="absolute top-0 left-0"
          style={{ width: colWidth > 0 ? `${colWidth}px` : undefined }}
        >
          <FilterControl
            organisms={allOrganisms}
            zones={zones}
            annotations={annotations}
            aiAnalyses={aiAnalyses}
            filters={filters}
            onFiltersChange={onFiltersChange}
          />
        </div>

        {colCount > 1 && (
          <div
            ref={sortRef}
            className="absolute top-0"
            style={{
              left: `${lastColX}px`,
              width: colWidth > 0 ? `${colWidth}px` : undefined,
            }}
          >
            <SortControl activeSort={sortMode} onSort={onSort} />
          </div>
        )}

        {placed.map((item) => {
          if (item.kind === "month") {
            return (
              <div
                key={item.key}
                className="absolute wall-card"
                style={
                  {
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.w}px`,
                    height: `${item.h}px`,
                    "--d": staggerStep(item.x, item.y, colWidth),
                  } as CSSProperties
                }
              >
                <HatchFiller
                  assignedStamp={{ type: "word", value: item.label }}
                  fillerIndex={0}
                  textColor="#b1c3ab" //#b1c3ab
                  textScale={0.65}
                  framed
                />
              </div>
            );
          }
          if (item.kind === "filler") {
            return (
              <div
                key={item.key}
                className="absolute wall-card"
                style={
                  {
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.w}px`,
                    height: `${item.h}px`,
                    "--d": staggerStep(item.x, item.y, colWidth),
                  } as CSSProperties
                }
              >
                <HatchFiller
                  assignedStamp={item.assignedStamp}
                  fillerIndex={item.fillerIndex}
                  neighbors={item.neighbors}
                />
              </div>
            );
          }
          if (item.kind === "fillerGroup") {
            return (
              <div
                key={item.key}
                className="absolute wall-card pointer-events-none"
                style={
                  {
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.w}px`,
                    height: `${item.h}px`,
                    "--d": staggerStep(item.x, item.y, colWidth),
                  } as CSSProperties
                }
              >
                <HatchFiller
                  assignedStamp={{ type: "blank" }}
                  fillerIndex={item.fillerIndex}
                  shape={item.shape}
                />
              </div>
            );
          }
          return (
            <div
              key={item.organism.id}
              data-tour={item.organism.id === tourCardId ? "card" : undefined}
              className="absolute wall-card"
              style={
                {
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.w}px`,
                  "--d": staggerStep(item.x, item.y, colWidth),
                } as CSSProperties
              }
            >
              <OrganismCard
                organism={item.organism}
                zoneNameByCode={zoneNameByCode}
                removed={
                  removedSet?.has(
                    removedComboKey(item.organism.shortCode, item.organism.zoneCode),
                  ) ?? false
                }
                selected={selectedId === item.organism.id}
                onSelect={handleSelect}
                onOpen={onOpenOrganism}
              />
            </div>
          );
        })}
      </div>
      <FooterRoots />
    </>
  );
}
