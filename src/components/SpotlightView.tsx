import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Plant, Zone, ZonePic } from "../types";
import { plantTitle } from "../utils/display";

const DOUBLE_CLICK_DELAY = 400;
const MOUSE_TOLERANCE = 20;
const TOUCH_TOLERANCE = 30;

export type SpotlightKind = "plant" | "zone";

interface Props {
  kind: SpotlightKind;
  subjectCode: string;
  allPlants: Plant[];
  zonePics: ZonePic[];
  zones: Zone[];
  onOpenViewer: (plant: Plant) => void;
}

interface PlantItem {
  kind: "plant";
  id: string;
  image: string;
  addedAt: string;
  width: number;
  height: number;
  plant: Plant;
}

interface ZoneItem {
  kind: "zone";
  id: string;
  image: string;
  addedAt: string;
  zoneCode: string;
}

type SpotlightItem = PlantItem | ZoneItem;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toPlantItem(p: Plant): PlantItem {
  return {
    kind: "plant",
    id: p.id,
    image: p.image,
    addedAt: p.addedAt,
    width: p.width,
    height: p.height,
    plant: p,
  };
}

function toZoneItem(z: ZonePic): ZoneItem {
  return {
    kind: "zone",
    id: z.id,
    image: z.image,
    addedAt: z.addedAt,
    zoneCode: z.zoneCode,
  };
}

export default function SpotlightView({
  kind,
  subjectCode,
  allPlants,
  zonePics,
  zones,
  onOpenViewer,
}: Props) {
  const items = useMemo<SpotlightItem[]>(() => {
    if (kind === "plant") {
      const list: SpotlightItem[] = allPlants
        .filter((p) => p.shortCode === subjectCode)
        .map(toPlantItem);
      return list.sort(
        (a, b) =>
          new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    }
    const byAddedDesc = (a: SpotlightItem, b: SpotlightItem) =>
      new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    const zoneItems: SpotlightItem[] = zonePics
      .filter((z) => z.zoneCode === subjectCode)
      .map(toZoneItem)
      .sort(byAddedDesc);
    const plantItems: SpotlightItem[] = allPlants
      .filter((p) => p.zoneCode === subjectCode)
      .map(toPlantItem)
      .sort(byAddedDesc);
    return [...zoneItems, ...plantItems];
  }, [allPlants, zonePics, kind, subjectCode]);

  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null
  );

  useEffect(() => {
    setSelectedId(items[0]?.id ?? null);
  }, [subjectCode, kind, items]);

  const hero = useMemo(
    () => items.find((p) => p.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  const headline = useMemo(() => {
    if (kind === "plant") {
      return hero?.kind === "plant" ? plantTitle(hero.plant) : subjectCode;
    }
    const z = zones.find((z) => z.code === subjectCode);
    return z?.name ?? subjectCode;
  }, [kind, hero, subjectCode, zones]);

  const subline = useMemo(() => {
    if (!hero) return null;
    if (kind === "plant" && hero.kind === "plant") {
      const z = zones.find((z) => z.code === hero.plant.zoneCode);
      return z?.name ?? hero.plant.zoneCode;
    }
    if (kind === "zone") {
      if (hero.kind === "plant") return plantTitle(hero.plant);
      return "zone photo";
    }
    return null;
  }, [hero, kind, zones]);

  if (items.length === 0 || !hero) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-ink-muted text-sm font-display tracking-wide">
          NO IMAGES
        </p>
      </div>
    );
  }

  const heroSrc = `${import.meta.env.BASE_URL}${hero.image}`;
  const heroTitle = hero.kind === "plant" ? plantTitle(hero.plant) : headline;
  const heroOpensViewer = hero.kind === "plant";

  return (
    <div className="pt-3 pb-6">
      <div className="flex flex-col items-center">
        <div className="w-full max-w-[420px] mx-auto">
          <div
            className={`relative rounded-sm overflow-hidden bg-surface-raised flex items-center justify-center ${
              heroOpensViewer ? "cursor-zoom-in" : "cursor-default"
            }`}
            onClick={() => {
              if (hero.kind === "plant") onOpenViewer(hero.plant);
            }}
            title={heroOpensViewer ? "Open in viewer" : undefined}
          >
            <img
              src={heroSrc}
              alt={heroTitle}
              className="block w-auto h-auto object-contain"
              style={{
                maxWidth: "100%",
                maxHeight: "min(45vh, 360px)",
              }}
              draggable={false}
            />
          </div>

          <div className="mt-3 px-1 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2
                className={`font-display text-ink leading-tight text-base sm:text-lg truncate ${
                  kind === "zone" ? "capitalize" : ""
                }`}
              >
                {headline}{" "}
                <span className="text-accent text-xs font-mono ml-1 align-middle">
                  {subjectCode}
                </span>
              </h2>
              {subline && (
                <p className="text-xs text-ink-muted mt-0.5 leading-snug">
                  {subline}
                </p>
              )}
            </div>
            <p className="text-[10px] text-ink-faint whitespace-nowrap font-mono shrink-0">
              {formatDate(hero.addedAt)}
            </p>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2 px-1">
            {items.length} photo{items.length === 1 ? "" : "s"}
          </p>
          <div className="columns-3 sm:columns-4 md:columns-5 lg:columns-6 gap-1.5">
            {items.map((it) => (
              <Thumb
                key={it.id}
                item={it}
                active={it.id === hero.id}
                onSingleClick={() => setSelectedId(it.id)}
                onDoubleClick={() => {
                  if (it.kind === "plant") onOpenViewer(it.plant);
                  else setSelectedId(it.id);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ThumbProps {
  item: SpotlightItem;
  active: boolean;
  onSingleClick: () => void;
  onDoubleClick: () => void;
}

function Thumb({ item, active, onSingleClick, onDoubleClick }: ThumbProps) {
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const now = Date.now();
      const isTouch = e.pointerType === "touch";
      const ref = isTouch ? lastTap : lastClick;
      const tolerance = isTouch ? TOUCH_TOLERANCE : MOUSE_TOLERANCE;
      const prev = ref.current;

      if (
        prev &&
        now - prev.time < DOUBLE_CLICK_DELAY &&
        Math.abs(e.clientX - prev.x) <= tolerance &&
        Math.abs(e.clientY - prev.y) <= tolerance
      ) {
        ref.current = null;
        onDoubleClick();
      } else {
        ref.current = { time: now, x: e.clientX, y: e.clientY };
        setTimeout(() => {
          if (ref.current && ref.current.time === now) {
            ref.current = null;
            onSingleClick();
          }
        }, DOUBLE_CLICK_DELAY);
      }
    },
    [onSingleClick, onDoubleClick]
  );

  const aspect =
    item.kind === "plant" &&
    item.width &&
    item.height &&
    item.width > 0 &&
    item.height > 0
      ? `${item.width} / ${item.height}`
      : "3 / 4";

  const altText =
    item.kind === "plant" ? plantTitle(item.plant) : "zone photo";

  return (
    <button
      type="button"
      onPointerUp={handlePointerUp}
      title={
        item.kind === "plant"
          ? "Click to enlarge · double-click to open"
          : "Click to enlarge"
      }
      className={`panel-item relative overflow-hidden rounded-sm bg-surface-raised group ring-1 ring-inset transition-all break-inside-avoid mb-1.5 block w-full ${
        active ? "ring-accent/70" : "ring-white/5 hover:ring-accent/30"
      }`}
      style={{ aspectRatio: aspect }}
    >
      <img
        src={`${import.meta.env.BASE_URL}${item.image}`}
        alt={altText}
        loading="lazy"
        decoding="async"
        className="block w-full h-full object-cover"
        draggable={false}
      />
      {active && (
        <span className="absolute inset-0 ring-2 ring-inset ring-accent/80 rounded-sm pointer-events-none" />
      )}
    </button>
  );
}
