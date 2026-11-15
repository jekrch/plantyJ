import { useEffect, useMemo, useState } from "react";
import { X, ZoomIn, ZoomOut, Info, Trash2 } from "lucide-react";
import {
  ImageViewer,
  originFromAttribute,
  type ViewerItem,
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

// Shared-element "zoom from thumbnail": the image expands out of / collapses
// back into the grid card carrying the organism's id. Off the grid (opened from
// a spotlight or a deep link) there's no card, so the library falls back to the
// fade.
const getOrigin = originFromAttribute<Organism>("data-organism-id");

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

  // Close the drawer whenever the active image changes; clear the slide-out
  // direction once the drawer has finished animating away.
  useEffect(() => {
    setDrawerOpen(false);
    const timer = setTimeout(() => setDrawerSlideDir(null), 450);
    return () => clearTimeout(timer);
  }, [currentIndex]);

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
      // The open viewer gets its own history entry, so the back button/gesture
      // closes it (running through onEscape first, so it dismisses an open
      // drawer before the viewer), and the URL names the open organism as
      // ?plant=<id> for sharing — cleared again when the viewer closes.
      history={{ param: "plant" }}
      // Push the image up out of the way while the details drawer is open.
      stageShift={drawerOpen ? "up" : null}
      // Match the old viewer's bottom spacing (the library defaults to 1.3rem,
      // which floats the nav row + hint text too high). Still floored by the
      // device safe-area inset.
      navInset="0.3rem"
      // Click empty space to close. The library suspends this while the drawer
      // has the stage shifted (its own toggle / Escape dismiss it instead).
      closeOnBackdropClick
      // Every wheel event zooms (1.0 defaults to trackpad behavior: a plain
      // scroll pans a zoomed image and is otherwise left to the browser).
      wheel="zoom"
      icons={viewerIcons}
      ariaLabel={`${organismTitle(organism)} — full view`}
      renderHeader={(ctx) => {
        const o = ctx.item.data;
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
      // The postedBy · date line, stacked under the top-bar controls.
      renderHeaderMeta={(ctx) => {
        const o = ctx.item.data;
        return (
          <>
            {o.postedBy} ·{" "}
            {new Date(o.addedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </>
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
      // Single image: there's no nav group to flank, so the Details toggle sits
      // centered in the footer instead (matching the old layout).
      renderFooter={(ctx) => {
        if (ctx.isZoomed || ctx.hasPrev || ctx.hasNext) return null;
        return (
          <div className="flex justify-center w-full px-4 sm:px-6">
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
          </div>
        );
      }}
      // Built-in gesture hint (touch vs. desktop, single vs. multiple images);
      // hides itself while zoomed or while the drawer is up.
      hint
      // "Removed" badge, pinned to the image's own top-left corner.
      renderImageOverlay={(ctx) => {
        const o = ctx.item.data;
        if (ctx.isZoomed || !isOrganismRemoved(o, removedSet)) return null;
        return (
          <span className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-sm bg-amber-900/80 px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wider text-amber-100 backdrop-blur-sm pointer-events-none">
            <Trash2 size={11} strokeWidth={1.75} />
            Removed
          </span>
        );
      }}
      renderOverlay={(ctx) => (
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
          // A taxon opens the tree. Close first and go there once the viewer
          // has stepped back off its history entry; writing the tree's URL
          // while that entry is still current would leave it behind the new
          // URL, costing an extra press of back.
          onSelectTaxon={(name) => ctx.close(() => onSelectTaxon(name))}
          onEntryChanged={onClose}
          topOffset={ctx.topBarHeight}
          bottomOffset={ctx.bottomBarHeight}
          slideDir={drawerSlideDir}
          aiAnalyses={aiAnalyses}
        />
      )}
    />
  );
}
