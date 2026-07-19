import { useEffect, useMemo, useState } from "react";
import { X, ZoomIn, ZoomOut, Info, Trash2 } from "lucide-react";
import {
  ImageViewer,
  type ViewerItem,
  type ViewerContext,
} from "@jekrch/react-viewport-lightbox";
import type { Annotation, Organism, Species, Zone, ZonePic } from "../types";
import { buildRemovedSet, isOrganismRemoved } from "../utils/removed";
import OrganismInfoDrawer, { AIAnalysis } from "./OrganismInfoDrawer";
import type { RelationshipsData } from "../hooks/useRelationships";
import { organismTitle } from "../utils/display";
import { imageSrc, loadJson } from "../data/source";

interface Props {
  organism: Organism;
  organisms: Organism[];
  allOrganisms: Organism[];
  zones: Zone[];
  zonePics: ZonePic[];
  annotations: Annotation[];
  speciesByShortCode: Map<string, Species>;
  relationships?: RelationshipsData;
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectOrganism: (organism: Organism, group?: Organism[]) => void;
  onSelectTaxon: (name: string) => void;
}

type OrganismItem = ViewerItem<Organism>;

// Chrome icons matched to the app's previous viewer (lucide at 16px / 1.5),
// overriding the library's slightly heavier 18px / 1.75 defaults. The bottom
// nav arrows are left to the library default (identical geometry, rendered at
// 38px via `--rvl-nav-height`).
const viewerIcons = {
  close: <X size={16} strokeWidth={1.5} />,
  zoomIn: <ZoomIn size={16} strokeWidth={1.5} />,
  zoomOut: <ZoomOut size={16} strokeWidth={1.5} />,
};

/**
 * Pushes the image stage up while the details drawer is open (revealing the
 * drawer that sits between the bars), then resets on close. `setContentShift`
 * is only reachable from a render slot's context, so this lives as a child of
 * the overlay slot and drives the shift from an effect.
 */
function DrawerContentShift({
  open,
  setContentShift,
}: {
  open: boolean;
  setContentShift: (transform: string | null, animate?: boolean) => void;
}) {
  useEffect(() => {
    setContentShift(open ? "translateY(-100vh)" : null);
    return () => setContentShift(null);
  }, [open, setContentShift]);
  return null;
}

export default function OrganismViewer({
  organism,
  organisms,
  allOrganisms,
  zones,
  zonePics,
  annotations,
  speciesByShortCode,
  relationships,
  currentIndex,
  onClose,
  onNavigate,
  onSelectOrganism,
  onSelectTaxon,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSlideDir, setDrawerSlideDir] = useState<"left" | "right" | null>(null);
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);

  useEffect(() => {
    loadJson<{ analyses?: AIAnalysis[] }>("ai_analysis.json")
      .then((data) => setAiAnalyses(data.analyses ?? []))
      .catch(console.error);
  }, []);

  const items = useMemo<OrganismItem[]>(
    () =>
      organisms.map((o) => ({
        id: o.id,
        src: imageSrc(o.image),
        alt: organismTitle(o),
        data: o,
      })),
    [organisms],
  );

  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);

  const removedSet = useMemo(() => buildRemovedSet(annotations), [annotations]);

  // Reflect the active organism in the URL (?plant=id), clearing it on close.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("plant", organism.id);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);

    return () => {
      const p = new URLSearchParams(window.location.search);
      if (p.get("plant") === organism.id) {
        p.delete("plant");
        const q = p.toString();
        const u = q ? `${window.location.pathname}?${q}` : window.location.pathname;
        window.history.replaceState(null, "", u);
      }
    };
  }, [organism.id]);

  // Close the drawer whenever the active image changes; clear the slide-out
  // direction once the drawer has finished animating away.
  useEffect(() => {
    setDrawerOpen(false);
    const timer = setTimeout(() => setDrawerSlideDir(null), 450);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  // Shared-element "zoom from thumbnail": hand the library the grid thumbnail
  // for the given index so the image expands out of / collapses back into it.
  // Falls back to the fade when the source isn't on screen (e.g. opened from a
  // spotlight or a deep link).
  const getOrigin = (index: number): HTMLElement | null => {
    const target = organisms[index];
    if (!target) return null;
    const nodes = document.querySelectorAll<HTMLElement>("[data-organism-id]");
    for (const node of nodes) {
      if (node.dataset.organismId === target.id) return node;
    }
    return null;
  };

  const hintText = (ctx: ViewerContext<Organism>, single: boolean) =>
    ctx.isTouchDevice
      ? single
        ? "pinch to zoom · double-tap to enlarge"
        : "swipe to navigate · pinch to zoom"
      : single
        ? "scroll to zoom · double-click to enlarge · esc to close"
        : "← → or drag to navigate · scroll to zoom · esc to close";

  return (
    <ImageViewer<Organism>
      items={items}
      index={currentIndex}
      onIndexChange={onNavigate}
      onClose={onClose}
      // Slide start: fling the open drawer out in the swipe direction and close
      // it, so it animates in step with the image.
      onNavigate={(dir) => {
        if (drawerOpen) {
          setDrawerSlideDir(dir === "next" ? "left" : "right");
          setDrawerOpen(false);
        }
      }}
      // Escape dismisses the drawer first (vetoing the close) when it's open.
      onEscape={() => {
        if (drawerOpen) {
          setDrawerOpen(false);
          return true;
        }
        return false;
      }}
      getOrigin={getOrigin}
      // Match the old viewer's bottom spacing (the library defaults to 1.3rem,
      // which floats the nav row + hint text too high). Still floored by the
      // device safe-area inset.
      navInset="0.3rem"
      // Click empty space to close — but never while the details drawer is open
      // (its own toggle / Escape dismiss it instead).
      closeOnBackdropClick={!drawerOpen}
      icons={viewerIcons}
      ariaLabel={`${organismTitle(organism)} — full view`}
      renderHeader={(ctx) => {
        const o = ctx.item.data!;
        const subtitle = zoneNameByCode.get(o.zoneCode) ?? o.zoneCode;
        return (
          <div style={{ width: "fit-content" }}>
            <p className="font-display text-sm text-white/90 leading-snug">
              {organismTitle(o)} <span className="text-accent text-xs">{o.shortCode}</span>
            </p>
            <p className="text-xs text-white/60 mt-0.5 leading-snug">{subtitle}</p>
          </div>
        );
      }}
      // The postedBy · date line, stacked under the top-bar controls (see the
      // `.viewer-meta` rule — it's pinned below the button row, not inline).
      renderHeaderActions={(ctx) => {
        const o = ctx.item.data!;
        return (
          <span className="viewer-meta">
            {o.postedBy} ·{" "}
            {new Date(o.addedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        );
      }}
      // Details toggle, pinned to the left of the centered nav group. Only when
      // there is a nav group to flank; the single-image case renders it centered
      // in the footer instead (matching the old layout).
      renderNavStart={(ctx) =>
        ctx.hasPrev || ctx.hasNext ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDrawerOpen((d) => !d);
            }}
            className={`viewer-btn viewer-btn-accent gap-1.5 ${drawerOpen ? "is-active" : ""}`}
            title="Show details"
          >
            <Info size={18} strokeWidth={2} />
            <span className="text-[11px] font-medium tracking-wide hidden sm:inline">Details</span>
          </button>
        ) : null
      }
      renderFooter={(ctx) => {
        if (ctx.isZoomed) return null;
        const single = !ctx.hasPrev && !ctx.hasNext;
        if (!single) {
          return (
            <div className="text-center mt-0 mb-1 mx-auto w-fit">
              <span className="text-[11px] text-white/30 tracking-wide">{hintText(ctx, false)}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center justify-center gap-2 w-full px-4 sm:px-6">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen((d) => !d);
              }}
              className={`viewer-btn viewer-btn-accent gap-1.5 ${drawerOpen ? "is-active" : ""}`}
              title="Show details"
            >
              <Info size={18} strokeWidth={2} />
              <span className="text-[11px] font-medium tracking-wide">Details</span>
            </button>
            <div className="text-center mx-auto w-fit">
              <span className="text-[11px] text-white/30 tracking-wide">{hintText(ctx, true)}</span>
            </div>
          </div>
        );
      }}
      // "Removed" badge, pinned to the image's own top-left corner.
      renderImageOverlay={(ctx) => {
        const o = ctx.item.data!;
        if (ctx.isZoomed || !isOrganismRemoved(o, removedSet)) return null;
        return (
          <span className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-sm bg-amber-900/80 px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wider text-amber-100 backdrop-blur-sm pointer-events-none">
            <Trash2 size={11} strokeWidth={1.75} />
            Removed
          </span>
        );
      }}
      renderOverlay={(ctx) => (
        <>
          <DrawerContentShift open={drawerOpen} setContentShift={ctx.setContentShift} />
          <OrganismInfoDrawer
            open={drawerOpen}
            closing={ctx.closing}
            organism={organism}
            allOrganisms={allOrganisms}
            zones={zones}
            zonePics={zonePics}
            annotations={annotations}
            speciesByShortCode={speciesByShortCode}
            relationships={relationships}
            onSelectOrganism={onSelectOrganism}
            onSelectTaxon={onSelectTaxon}
            onEntryChanged={onClose}
            topOffset={ctx.topBarHeight}
            bottomOffset={ctx.bottomBarHeight}
            slideDir={drawerSlideDir}
            aiAnalyses={aiAnalyses}
          />
        </>
      )}
    />
  );
}
