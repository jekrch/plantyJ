import { useRef, useCallback } from "react";
import type { Plant } from "../types";
import { Expand } from "lucide-react";
import { plantTitle } from "../utils/display";

const DOUBLE_CLICK_DELAY = 400;
const MOUSE_TOLERANCE = 20;
const TOUCH_TOLERANCE = 30;

interface Props {
  plant: Plant;
  zoneNameByCode: Map<string, string>;
  onOpen: (plant: Plant) => void;
}

export default function PlantCard({ plant, zoneNameByCode, onOpen }: Props) {
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastClick = useRef<{ time: number; x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const imgSrc = `${import.meta.env.BASE_URL}${plant.image}`;

  const aspectRatio =
    plant.width && plant.height && plant.width > 0 && plant.height > 0
      ? `${plant.width} / ${plant.height}`
      : "3 / 4";

  const openViewer = useCallback(() => {
    onOpen(plant);
  }, [onOpen, plant]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const now = Date.now();
      const isTouch = e.pointerType === "touch";

      if (isTouch && overlayRef.current) {
        const opacity = window.getComputedStyle(overlayRef.current).opacity;
        if (opacity === "0") {
          lastTap.current = null;
          return;
        }
      }

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
        openViewer();
      } else {
        ref.current = { time: now, x: e.clientX, y: e.clientY };
      }
    },
    [openViewer]
  );

  const titleLine = plantTitle(plant);
  const subtitle = zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode;

  return (
    <div
      className="panel-item group relative cursor-pointer overflow-hidden rounded-sm bg-surface-raised"
      style={{ WebkitMaskImage: "radial-gradient(white, white)" }}
      onPointerUp={handlePointerUp}
    >
      <div style={{ aspectRatio, width: "100%" }}>
        <img
          ref={imgRef}
          src={imgSrc}
          alt={titleLine}
          decoding="async"
          loading="lazy"
          className="block w-full"
          style={{ aspectRatio }}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            el.parentElement!.querySelector<HTMLDivElement>(
              ".fallback"
            )!.style.display = "flex";
          }}
        />
        <div
          className="fallback hidden items-center justify-center bg-surface-raised text-ink-faint text-xs font-display"
          style={{ aspectRatio: "3/4" }}
        >
          {titleLine}
        </div>
      </div>

      <div
        ref={overlayRef}
        className="panel-overlay absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            openViewer();
          }}
          className="
            absolute top-2 right-2
            w-8 h-8 flex items-center justify-center
            rounded-md bg-black/50 backdrop-blur-sm
            text-white/70 hover:text-white hover:bg-black/70
            transition-all duration-150 ease-out
            focus:outline-none focus:ring-1 focus:ring-white/30
            active:scale-95
          "
          aria-label={`View ${titleLine} full screen`}
        >
          <Expand size={16} />
        </button>

        <p className="font-display text-sm text-white leading-tight">
          {titleLine}{" "}
          <span className="text-accent text-[10px]">{plant.shortCode}</span>
        </p>
        <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
        {/* {plant.description && (
          <p className="text-xs text-ink-muted/70 mt-1 italic leading-snug line-clamp-2">
            {plant.description}
          </p>
        )} */}
        {plant.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {plant.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] leading-none px-1.5 py-0.5 rounded-sm bg-white/10 text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
