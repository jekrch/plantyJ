import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Organism, Zone, ZonePic } from "../types";
import { organismTitle } from "../utils/display";

const DOUBLE_CLICK_DELAY = 400;
const MOUSE_TOLERANCE = 20;
const TOUCH_TOLERANCE = 30;

export type SpotlightKind = "plant" | "zone";

interface Props {
  kind: SpotlightKind;
  subjectCode: string;
  allOrganisms: Organism[];
  zonePics: ZonePic[];
  zones: Zone[];
  onOpenViewer: (organism: Organism) => void;
}

interface OrganismItem {
  kind: "plant";
  id: string;
  image: string;
  addedAt: string;
  width: number;
  height: number;
  organism: Organism;
}

interface ZoneItem {
  kind: "zone";
  id: string;
  image: string;
  addedAt: string;
  zoneCode: string;
}

type SpotlightItem = OrganismItem | ZoneItem;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toOrganismItem(p: Organism): OrganismItem {
  return {
    kind: "plant",
    id: p.id,
    image: p.image,
    addedAt: p.addedAt,
    width: p.width,
    height: p.height,
    organism: p,
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
  allOrganisms,
  zonePics,
  zones,
  onOpenViewer,
}: Props) {
  const items = useMemo<SpotlightItem[]>(() => {
    if (kind === "plant") {
      const list: SpotlightItem[] = allOrganisms
        .filter((p) => p.shortCode === subjectCode)
        .map(toOrganismItem);
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
    const organismItems: SpotlightItem[] = allOrganisms
      .filter((p) => p.zoneCode === subjectCode)
      .map(toOrganismItem)
      .sort(byAddedDesc);
    return [...zoneItems, ...organismItems];
  }, [allOrganisms, zonePics, kind, subjectCode]);

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
      return hero?.kind === "plant" ? organismTitle(hero.organism) : subjectCode;
    }
    const z = zones.find((z) => z.code === subjectCode);
    return z?.name ?? subjectCode;
  }, [kind, hero, subjectCode, zones]);

  const subline = useMemo(() => {
    if (!hero) return null;
    if (kind === "plant" && hero.kind === "plant") {
      const z = zones.find((z) => z.code === hero.organism.zoneCode);
      return z?.name ?? hero.organism.zoneCode;
    }
    if (kind === "zone") {
      if (hero.kind === "plant") return organismTitle(hero.organism);
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
  const heroTitle = hero.kind === "plant" ? organismTitle(hero.organism) : headline;
  const heroOpensViewer = hero.kind === "plant";

  return (
    <div className="pt-3 pb-6">
      <div className="flex flex-col items-center">
        <div className="w-full max-w-[420px] mx-auto">
          <div
            className={`relative rounded-sm overflow-hidden bg-surface-raised flex items-center justify-center w-full ${
              heroOpensViewer ? "cursor-zoom-in" : "cursor-default"
            }`}
            style={{ height: "min(45vh, 360px)" }}
            onClick={() => {
              if (hero.kind === "plant") onOpenViewer(hero.organism);
            }}
            title={heroOpensViewer ? "Open in viewer" : undefined}
          >
            <img
              src={heroSrc}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-50"
              draggable={false}
            />
            <img
              src={heroSrc}
              alt={heroTitle}
              className="relative z-10 block w-full h-full object-contain"
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
            {items.map((it) => {
              let thumbLabel: string | undefined;
              if (kind === "plant" && it.kind === "plant") {
                const z = zones.find((z) => z.code === it.organism.zoneCode);
                thumbLabel = z?.name ?? it.organism.zoneCode;
              } else if (kind === "zone" && it.kind === "plant") {
                thumbLabel = organismTitle(it.organism);
              }
              return (
                <Thumb
                  key={it.id}
                  item={it}
                  active={it.id === hero.id}
                  label={thumbLabel}
                  onSingleClick={() => setSelectedId(it.id)}
                  onDoubleClick={() => {
                    if (it.kind === "plant") onOpenViewer(it.organism);
                    else setSelectedId(it.id);
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface ThumbProps {
  item: SpotlightItem;
  active: boolean;
  label?: string;
  onSingleClick: () => void;
  onDoubleClick: () => void;
}

function Thumb({ item, active, label, onSingleClick, onDoubleClick }: ThumbProps) {
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
    item.kind === "plant" ? organismTitle(item.organism) : "zone photo";

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
      {label && (
        <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[12px] text-white/80 bg-linear-to-t from-black/80 to-black/20 leading-tight truncate pointer-events-none">
          {label}
        </span>
      )}
      {active && (
        <span className="absolute inset-0 ring-2 ring-inset ring-accent/80 rounded-sm pointer-events-none" />
      )}
    </button>
  );
}
