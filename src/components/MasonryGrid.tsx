import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { Plant, Zone } from "../types";
import type { SortMode } from "../utils/sorting";
import type { Filters } from "../utils/filtering";
import PlantCard from "./PlantCard";
import FilterControl from "./FilterControl";
import SortControl from "./SortControl";
import HatchFiller from "./HatchFiller";
import { buildStampPool } from "./HatchFiller";
import type { StampDef } from "./HatchFiller";
import FooterPyramid from "./FooterPryamid";
import { resolveNeighbors } from "../adjacency";
import type { NeighborMap } from "../adjacency";

const GAP = 4;
const DEFAULT_ASPECT = 3 / 4;
const WIDE_THRESHOLD = 1.4;

function getColumnCount() {
  if (typeof window === "undefined") return 3;
  const w = window.innerWidth;
  if (w <= 620) return 2;
  return 3;
}

function getAspect(plant: Plant): number {
  if (plant.width && plant.height && plant.width > 0 && plant.height > 0) {
    return plant.width / plant.height;
  }
  return DEFAULT_ASPECT;
}

function isWide(plant: Plant): boolean {
  return getAspect(plant) >= WIDE_THRESHOLD;
}

interface PlacedPlant {
  kind: "panel";
  plant: Plant;
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

type PlacedItem = PlacedPlant | PlacedFiller;

function assignStampsToFillers(fillers: PlacedFiller[]): void {
  const pool = buildStampPool();
  const poolSize = pool.length;
  for (let i = 0; i < fillers.length; i++) {
    fillers[i].assignedStamp = pool[i % poolSize];
    fillers[i].fillerIndex = i;
  }
}

function getPlantHeight(plant: Plant, width: number): number {
  const aspect = getAspect(plant);
  return width / aspect;
}

function computeLayout(
  plants: Plant[],
  colCount: number,
  containerWidth: number,
  initialHeights: number[]
): { items: PlacedItem[]; totalHeight: number } {
  const colWidth = (containerWidth - GAP * (colCount - 1)) / colCount;
  const colX = (col: number) => col * (colWidth + GAP);
  const heights = [...initialHeights];
  const items: PlacedItem[] = [];

  const placeholder: StampDef = { type: "word", value: "" };
  const emptyNeighbors: NeighborMap = {};

  for (let idx = 0; idx < plants.length; idx++) {
    const plant = plants[idx];
    const aspect = getAspect(plant);
    const wide = isWide(plant) && colCount >= 2;

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
          key: `filler-${plant.id}-L`,
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
          key: `filler-${plant.id}-R`,
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
      const plantH = spanW / aspect;
      items.push({
        kind: "panel",
        plant,
        x: colX(col1),
        y: tallest,
        w: spanW,
      });

      const newH = tallest + plantH + GAP;
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

      const plantH = colWidth / aspect;
      items.push({
        kind: "panel",
        plant,
        x: colX(targetCol),
        y: heights[targetCol],
        w: colWidth,
      });
      heights[targetCol] += plantH + GAP;
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
          panel: item.plant,
          x: item.x,
          y: item.y,
          w: item.w,
          h: getPlantHeight(item.plant, item.w),
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
    getPlantHeight
  );

  for (const filler of fillers) {
    const resolved = neighborMap.get(filler.key);
    if (resolved) filler.neighbors = resolved;
  }

  return { items, totalHeight };
}

interface MasonryGridProps {
  plants: Plant[];
  allPlants: Plant[];
  zones: Zone[];
  sortMode: SortMode;
  onSort: (mode: SortMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onLayoutReady?: () => void;
  onPlantPositions?: (positions: { plant: Plant; y: number; h: number }[]) => void;
  onOpenPlant: (plant: Plant) => void;
}

export default function MasonryGrid({
  plants,
  allPlants,
  zones,
  sortMode,
  onSort,
  filters,
  onFiltersChange,
  onLayoutReady,
  onPlantPositions,
  onOpenPlant,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedItem[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [colCount, setColCount] = useState(getColumnCount);
  const [colWidth, setColWidth] = useState(0);

  const stampCacheRef = useRef<
    Map<string, { stamp: StampDef; fillerIndex: number }>
  >(new Map());

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

    const result = computeLayout(plants, cc, containerWidth, initialHeights);

    const fillers = result.items.filter(
      (i): i is PlacedFiller => i.kind === "filler"
    );
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

    setPlaced(result.items);
    setTotalHeight(result.totalHeight);

    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("masonry-layout"));
    });
  }, [plants]);

  const prevPlantIdsRef = useRef<string>("");
  useEffect(() => {
    const ids = plants.map((p) => p.id).join(",");
    if (ids !== prevPlantIdsRef.current) {
      prevPlantIdsRef.current = ids;
      stampCacheRef.current.clear();
    }
  }, [plants]);

  useEffect(() => {
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

        const allImgs = Array.from(
          document.querySelectorAll<HTMLImageElement>(".panel-item img")
        );

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

  const lastColX = (colCount - 1) * (colWidth + GAP);

  useEffect(() => {
    if (!onPlantPositions || placed.length === 0) return;
    const positions = placed
      .filter((item): item is PlacedPlant => item.kind === "panel")
      .map((item) => ({
        plant: item.plant,
        y: item.y,
        h: getPlantHeight(item.plant, item.w),
      }));
    onPlantPositions(positions);
  }, [placed, onPlantPositions]);

  return (
    <>
      <div
        ref={containerRef}
        className="relative"
        style={{ height: `${totalHeight}px` }}
      >
        <div
          ref={filterRef}
          className="absolute top-0 left-0"
          style={{ width: colWidth > 0 ? `${colWidth}px` : undefined }}
        >
          <FilterControl
            plants={allPlants}
            zones={zones}
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
          if (item.kind === "filler") {
            return (
              <div
                key={item.key}
                className="absolute"
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.w}px`,
                  height: `${item.h}px`,
                }}
              >
                <HatchFiller
                  assignedStamp={item.assignedStamp}
                  fillerIndex={item.fillerIndex}
                  neighbors={item.neighbors}
                />
              </div>
            );
          }
          return (
            <div
              key={item.plant.id}
              className="absolute"
              style={{
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.w}px`,
              }}
            >
              <PlantCard
                plant={item.plant}
                zoneNameByCode={zoneNameByCode}
                onOpen={onOpenPlant}
              />
            </div>
          );
        })}
      </div>
      <FooterPyramid />
    </>
  );
}
