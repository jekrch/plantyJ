import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, Info } from "lucide-react";
import type { Annotation, Plant, Species, Zone, ZonePic } from "../types";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { MAX_SCALE, MIN_SCALE, useZoomPan } from "../hooks/useZoomPan";
import { useBarMeasure } from "../hooks/useBarMeasure";
import { useGestureHandler } from "../hooks/useGestureHandler";
import { useSlideNavigation } from "../hooks/useSlideNavigation";
import NavButton from "./NavButton";
import PlantInfoDrawer, { AIAnalysis } from "./PlantInfoDrawer";
import type { RelationshipsData } from "../hooks/useRelationships";
import { plantTitle } from "../utils/display";

interface Props {
  plant: Plant;
  plants: Plant[];
  allPlants: Plant[];
  zones: Zone[];
  zonePics: ZonePic[];
  annotations: Annotation[];
  speciesByShortCode: Map<string, Species>;
  relationships?: RelationshipsData;
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectPlant: (plant: Plant) => void;
  onSelectTaxon: (name: string) => void;
}

export default function PlantViewer({
  plant,
  plants,
  allPlants,
  zones,
  zonePics,
  annotations,
  speciesByShortCode,
  relationships,
  currentIndex,
  onClose,
  onNavigate,
  onSelectPlant,
  onSelectTaxon,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSlideDir, setDrawerSlideDir] = useState<"left" | "right" | null>(
    null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const imgWrapperRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < plants.length - 1;

  useBodyScrollLock(containerRef);
  const { topBarH, bottomBarH } = useBarMeasure(topBarRef, bottomBarRef, currentIndex);

  const zoomPan = useZoomPan(imgWrapperRef, currentIndex);
  const {
    imgRef,
    displayScale,
    isZoomed,
    transformRef,
    resetTransform,
    setTransform,
    clampTranslate,
    measureBaseDims,
    handleDoubleClick,
  } = zoomPan;

  const slide = useSlideNavigation(plants, currentIndex, onNavigate);
  const { slideTrackRef, slideActive, slideAnimating, swipeOffset, commitSlide } = slide;

  const gestures = useGestureHandler(zoomPan, slide, hasPrev, hasNext);

  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/ai_analysis.json`)
      .then(res => res.json())
      .then(data => setAiAnalyses(data.analyses)) 
      .catch(console.error);
  }, []);

  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setVisible(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  const handleNavigate = useCallback(
    (dir: "prev" | "next") => {
      const slideOut = dir === "next" ? "left" : "right";
      if (drawerOpen) {
        setDrawerSlideDir(slideOut);
        setDrawerOpen(false);
      }
      commitSlide(dir);
    },
    [drawerOpen, commitSlide]
  );

  useEffect(() => {
    setDrawerOpen(false);
    const timer = setTimeout(() => setDrawerSlideDir(null), 450);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("plant", plant.id);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);

    return () => {
      const p = new URLSearchParams(window.location.search);
      if (p.get("plant") === plant.id) {
        p.delete("plant");
        const q = p.toString();
        const u = q ? `${window.location.pathname}?${q}` : window.location.pathname;
        window.history.replaceState(null, "", u);
      }
    };
  }, [plant.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawerOpen) {
          setDrawerOpen(false);
          return;
        }
        handleClose();
      }
      if (e.key === "ArrowLeft" && hasPrev && displayScale <= 1) handleNavigate("prev");
      if (e.key === "ArrowRight" && hasNext && displayScale <= 1) handleNavigate("next");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, hasPrev, hasNext, displayScale, drawerOpen, handleNavigate]);

  const IMG_PADDING = 44;
  const reservedH = bottomBarH + IMG_PADDING * 2;
  const imgMaxHeight = `calc(100vh - ${reservedH}px)`;

  const totalDigits = String(plants.length).length;
  const counterMinWidth = `${totalDigits * 2 * 0.6 + 1.5}em`;

  const prevPlant = hasPrev ? plants[currentIndex - 1] : null;
  const nextPlant = hasNext ? plants[currentIndex + 1] : null;
  const showAdjacentSlides = slideActive || slideAnimating || swipeOffset !== 0;
  const showPrev = !!prevPlant && showAdjacentSlides;
  const showNext = !!nextPlant && showAdjacentSlides;
  const adjacentOpacity = Math.min(1, Math.abs(swipeOffset) / (viewportWidth * 0.8));

  const slideImgStyle: React.CSSProperties = {
    maxWidth: "96vw",
    maxHeight: imgMaxHeight,
    willChange: "transform",
  };

  const slideTrackTransform = drawerOpen ? "translateY(-100vh)" : "translateY(0)";

  const titleLine = plantTitle(plant);
  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);
  const subtitle = zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode;

  return (
    <div
      ref={containerRef}
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        transition-all duration-250 ease-out
        ${visible && !closing ? "bg-black/90" : "bg-black/0"}
      `}
      style={{ touchAction: "none" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${titleLine} — full view`}
    >
      <div
        className={`
          absolute inset-0 z-0 transition-all duration-250 ease-out
          ${visible && !closing ? "backdrop-blur-sm" : "backdrop-blur-0"}
        `}
        onClick={drawerOpen ? () => setDrawerOpen(false) : handleClose}
        aria-hidden="true"
      />

      <div
        ref={topBarRef}
        className={`
          absolute top-0 inset-x-0 z-20 flex items-start justify-between
          px-4 py-3 sm:px-6 sm:py-4
          bg-gradient-to-b from-black/70 via-black/40 to-transparent
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"}
        `}
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          pointerEvents: "none",
        }}
      >
        <div className="min-w-0 flex-1 px-2!" style={{ pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", width: "fit-content" }}>
            <p className="font-display text-sm text-white/90 leading-snug">
              {titleLine}{" "}
              <span className="text-accent text-xs">{plant.shortCode}</span>
            </p>
            <p className="text-xs text-white/60 mt-0.5 leading-snug">{subtitle}</p>
          </div>
        </div>

        <div
          className="flex flex-col items-end ml-3 shrink-0"
          style={{ pointerEvents: "auto" }}
        >
          <div className="flex items-center gap-1">
            {!isTouchDevice && !drawerOpen && isZoomed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetTransform();
                }}
                className="viewer-btn text-[11px] tabular-nums font-mono"
                title="Reset zoom"
              >
                {Math.round(displayScale * 100)}%
              </button>
            )}

            {!isTouchDevice && !drawerOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const t = transformRef.current;
                  const next = Math.min(MAX_SCALE, t.scale * 1.3);
                  const clamped = clampTranslate(t.x, t.y, next);
                  setTransform({ scale: next, ...clamped }, true);
                }}
                className="viewer-btn"
                title="Zoom in"
              >
                <ZoomIn size={16} strokeWidth={1.5} />
              </button>
            )}

            {!isTouchDevice && !drawerOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const t = transformRef.current;
                  const next = Math.max(MIN_SCALE, t.scale / 1.3);
                  const clamped =
                    next <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, next);
                  setTransform({ scale: next, ...clamped }, true);
                }}
                className="viewer-btn"
                title="Zoom out"
              >
                <ZoomOut size={16} strokeWidth={1.5} />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className={`viewer-btn ${!isTouchDevice ? "ml-1" : ""}`}
              title="Close (Esc)"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          <p className="text-[10px] text-white/30 mt-1 leading-snug whitespace-nowrap mt-2">
            {plant.postedBy} ·{" "}
            {new Date(plant.addedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div
        className="relative z-10 w-full h-full"
        style={{
          transform: slideTrackTransform,
          transition: "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        <div
          ref={slideTrackRef}
          className={`
            relative flex items-center justify-center w-full h-full
            transition-opacity duration-250 ease-out
            ${visible && !closing ? "opacity-100" : "opacity-0"}
          `}
          style={{ touchAction: "none", pointerEvents: "none" }}
        >
          {showPrev && prevPlant && (
            <div
              className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
              style={{
                transform: `translateX(-${viewportWidth}px)`,
                opacity: adjacentOpacity,
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${prevPlant.image}`}
                alt=""
                className="block w-auto h-auto object-contain rounded-sm"
                style={slideImgStyle}
                draggable={false}
              />
            </div>
          )}

          <div
            ref={imgWrapperRef}
            className="relative flex items-center justify-center select-none overflow-hidden cursor-default"
            style={{ touchAction: "none", pointerEvents: "auto" }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={handleDoubleClick}
            onPointerDown={gestures.handlePointerDown}
            onPointerMove={gestures.handlePointerMove}
            onPointerUp={gestures.handlePointerUp}
            onPointerLeave={gestures.handlePointerUp}
            onTouchStart={gestures.handleTouchStart}
            onTouchMove={gestures.handleTouchMove}
            onTouchEnd={gestures.handleTouchEnd}
          >
            <img
              ref={imgRef}
              src={`${import.meta.env.BASE_URL}${plant.image}`}
              alt={titleLine}
              className="block w-auto h-auto object-contain rounded-sm"
              style={slideImgStyle}
              draggable={false}
              onLoad={measureBaseDims}
            />
          </div>

          {showNext && nextPlant && (
            <div
              className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
              style={{
                transform: `translateX(${viewportWidth}px)`,
                opacity: adjacentOpacity,
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${nextPlant.image}`}
                alt=""
                className="block w-auto h-auto object-contain rounded-sm"
                style={slideImgStyle}
                draggable={false}
              />
            </div>
          )}
        </div>
      </div>

      <div
        ref={bottomBarRef}
        className={`
          absolute bottom-0 inset-x-0 z-20 pt-4
          transition-all duration-250 ease-out
          ${visible && !closing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
        style={{
          paddingBottom: "max(0.3rem, env(safe-area-inset-bottom))",
          pointerEvents: "none",
        }}
      >
        {!isZoomed && (hasPrev || hasNext) && (
          <div
            className="w-full px-4 sm:px-6"
            style={{ pointerEvents: "auto" }}
          >
            <div className="relative flex items-center justify-center max-w-2xl mx-auto">
              {/* Info Button - Positioned left within the centered max-width row */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerOpen((d) => !d);
                }}
                className={`viewer-btn viewer-btn-accent absolute left-0 gap-1.5 ${
                  drawerOpen ? "is-active" : ""
                }`}
                title="Show details"
              >
                <Info size={18} strokeWidth={2} />
                <span className="text-[11px] font-medium tracking-wide hidden sm:inline">
                  Details
                </span>
              </button>

              {/* Navigation Group - Now perfectly centered in isolation */}
              <div className="flex items-center justify-center gap-3">
                <NavButton
                  direction="prev"
                  enabled={hasPrev}
                  onClick={() => handleNavigate("prev")}
                />

                <span
                  className="text-[11px] text-white/50 tabular-nums tracking-wide select-none text-center inline-block font-mono"
                  style={{ minWidth: counterMinWidth }}
                >
                  {currentIndex + 1} / {plants.length}
                </span>

                <NavButton
                  direction="next"
                  enabled={hasNext}
                  onClick={() => handleNavigate("next")}
                />
              </div>
            </div>
          </div>
        )}

        {!isZoomed && (hasPrev || hasNext) && (
          <div
            className="text-center mt-0 mb-1 mx-auto w-fit"
            style={{ pointerEvents: "auto" }}
          >
            <span className="text-[11px] text-white/30 tracking-wide">
              {isTouchDevice
                ? "swipe to navigate · pinch to zoom"
                : "← → or drag to navigate · scroll to zoom · esc to close"}
            </span>
          </div>
        )}

        {!isZoomed && !hasPrev && !hasNext && (
          <div           
            className="flex flex-col items-center justify-center gap-2 w-full px-4 sm:px-6"
            style={{ pointerEvents: "auto" }}
          >
            {/* Info Button - Now perfectly centered */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen((d) => !d);
              }}
              className={`viewer-btn viewer-btn-accent gap-1.5 ${
                drawerOpen ? "is-active" : ""
              }`}
              title="Show details"
            >
              <Info size={18} strokeWidth={2} />
              <span className="text-[11px] font-medium tracking-wide">
                Details
              </span>
            </button>

            {/* Helper Text - Stacked below the button */}
            <div className="text-center mx-auto w-fit">
              <span className="text-[11px] text-white/30 tracking-wide">
                {isTouchDevice
                  ? "pinch to zoom · double-tap to enlarge"
                  : "scroll to zoom · double-click to enlarge · esc to close"}
              </span>
            </div>
          </div>
        )}
      </div>

      <PlantInfoDrawer
        open={drawerOpen}
        closing={closing}
        plant={plant}
        allPlants={allPlants}
        zones={zones}
        zonePics={zonePics}
        annotations={annotations}
        speciesByShortCode={speciesByShortCode}
        relationships={relationships}
        onSelectPlant={onSelectPlant}
        onSelectTaxon={onSelectTaxon}
        topOffset={topBarH}
        bottomOffset={bottomBarH}
        slideDir={drawerSlideDir}
        aiAnalyses={aiAnalyses}
      />
    </div>
  );
}
