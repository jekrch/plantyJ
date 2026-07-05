import { useCallback } from "react";
import type { Organism } from "../types";
import { Expand, Trash2 } from "lucide-react";
import { organismTitle } from "../utils/display";
import { imageTime } from "../utils/sorting";

function formatPicTime(organism: Organism): string {
  const d = new Date(imageTime(organism));
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

interface Props {
  organism: Organism;
  zoneNameByCode: Map<string, string>;
  /** This pic's plant+zone combo has been removed from the garden. */
  removed?: boolean;
  /** This card is the one currently revealing its details overlay. */
  selected: boolean;
  /** Reveal this card's details (and hide any other card's). */
  onSelect: (organism: Organism) => void;
  onOpen: (organism: Organism) => void;
}

export default function OrganismCard({
  organism,
  zoneNameByCode,
  removed = false,
  selected,
  onSelect,
  onOpen,
}: Props) {
  const imgSrc = `${import.meta.env.BASE_URL}${organism.image}`;

  const aspectRatio =
    organism.width && organism.height && organism.width > 0 && organism.height > 0
      ? `${organism.width} / ${organism.height}`
      : "3 / 4";

  const openViewer = useCallback(() => {
    onOpen(organism);
  }, [onOpen, organism]);

  // First tap reveals the details; tapping the already-selected card opens the
  // full viewer. Selecting one card deselects any other (handled by the parent),
  // so there is no timing window — the two taps can be arbitrarily far apart.
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (selected) openViewer();
      else onSelect(organism);
    },
    [selected, openViewer, onSelect, organism],
  );

  const titleLine = organismTitle(organism);
  const subtitle = zoneNameByCode.get(organism.zoneCode) ?? organism.zoneCode;
  const picTime = formatPicTime(organism);

  return (
    <div
      data-organism-id={organism.id}
      className={`panel-item group relative cursor-pointer overflow-hidden rounded-sm bg-surface-raised ${
        selected ? "panel-selected" : ""
      } ${removed ? "ring-1 ring-inset ring-amber-500/50" : ""}`}
      onPointerUp={handlePointerUp}
    >
      <div style={{ aspectRatio, width: "100%" }}>
        <img
          src={imgSrc}
          alt={titleLine}
          decoding="async"
          loading="lazy"
          className={`block w-full ${removed ? "grayscale opacity-60" : ""}`}
          style={{ aspectRatio }}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            el.parentElement!.querySelector<HTMLDivElement>(".fallback")!.style.display = "flex";
          }}
        />
        <div
          className="fallback hidden items-center justify-center bg-surface-raised text-ink-faint text-xs font-display"
          style={{ aspectRatio: "3/4" }}
        >
          {titleLine}
        </div>
        {removed && (
          <span className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-sm bg-amber-900/80 px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wider text-amber-100 backdrop-blur-sm pointer-events-none">
            <Trash2 size={11} strokeWidth={1.75} />
            Removed
          </span>
        )}
      </div>

      <div className="panel-overlay absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3">
        <button
          onPointerUp={(e) => e.stopPropagation()}
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
          {titleLine} <span className="text-accent text-[10px]">{organism.shortCode}</span>
        </p>
        <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
        {/* {organism.description && (
          <p className="text-xs text-ink-muted/70 mt-1 italic leading-snug line-clamp-2">
            {organism.description}
          </p>
        )} */}
        {picTime && (
          <span className="absolute bottom-2 right-2 text-[10px] leading-none text-ink-muted/80 tabular-nums">
            {picTime}
          </span>
        )}
        {organism.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {organism.tags.map((tag) => (
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
