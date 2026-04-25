import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomPanState {
  imgRef: RefObject<HTMLImageElement | null>;
  displayScale: number;
  isZoomed: boolean;
  transformRef: React.MutableRefObject<Transform>;

  /** Base (unscaled) image dimensions for clamp calculations */
  baseDimsRef: React.MutableRefObject<{ width: number; height: number }>;

  resetTransform: () => void;
  setTransform: (t: Transform, animate?: boolean) => void;
  applyTransform: (t: Transform, animate?: boolean) => void;
  clampTranslate: (x: number, y: number, scale: number) => { x: number; y: number };
  measureBaseDims: () => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
}

/**
 * Manages zoom/pan state for an image viewer.
 *
 * Applies scale + translate transforms to the **wrapper** element rather
 * than the image itself. This avoids an iOS Safari compositing bug where
 * CSS scale() on an element clips its painted output to the element's
 * original layout bounds.
 *
 * When zoomed, the wrapper is positioned absolute inset-0 (full viewport),
 * so its layout bounds already match the viewport and scaling it won't clip.
 * The image stays at its natural constrained size, centered via flexbox.
 */
export function useZoomPan(
  imgWrapperRef: RefObject<HTMLDivElement | null>,
  currentIndex: number
): ZoomPanState {
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });
  const baseDimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Core helpers

  const applyTransform = useCallback((t: Transform, animate = false) => {
    const wrapper = imgWrapperRef.current;
    if (!wrapper) return;
    wrapper.style.transition = animate ? "transform 0.2s ease-out" : "none";

    if (t.scale <= 1) {
      wrapper.style.transform = "none";
      wrapper.style.position = "";
      wrapper.style.inset = "";
      wrapper.style.zIndex = "";
      wrapper.style.backgroundColor = "";
      wrapper.style.cursor = "";
    } else {
      wrapper.style.transform =
        `scale(${t.scale}) translate(${t.x / t.scale}px, ${t.y / t.scale}px)`;
      wrapper.style.position = "absolute";
      wrapper.style.inset = "0";
      wrapper.style.zIndex = "30";
      wrapper.style.backgroundColor = "black";
      wrapper.style.cursor = "grab";
    }

    // Keep React state in sync so isZoomed reflects reality
    setDisplayScale(t.scale);
  }, [imgWrapperRef]);

  const setTransform = useCallback(
    (t: Transform, animate = false) => {
      transformRef.current = t;
      applyTransform(t, animate);
      setDisplayScale(t.scale);
    },
    [applyTransform]
  );

  const resetTransform = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 }, true);
  }, [setTransform]);

  const measureBaseDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
  }, []);

  /**
   * Clamp so the image edge can't pan past the viewport edge.
   */
  const clampTranslate = useCallback(
    (x: number, y: number, scale: number): { x: number; y: number } => {
      if (scale <= 1) return { x: 0, y: 0 };
      const { width: baseW, height: baseH } = baseDimsRef.current;
      if (baseW === 0 || baseH === 0) return { x: 0, y: 0 };

      const scaledHalfW = (baseW * scale) / 2;
      const scaledHalfH = (baseH * scale) / 2;
      const vpHalfW = window.innerWidth / 2;
      const vpHalfH = window.innerHeight / 2;

      const maxX = Math.max(0, scaledHalfW - vpHalfW);
      const maxY = Math.max(0, scaledHalfH - vpHalfH);

      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    []
  );

  // Reset on navigation 

  useLayoutEffect(() => {
    const wrapper = imgWrapperRef.current;
    if (wrapper) {
      wrapper.style.transition = "none";
      wrapper.style.transform = "none";
      wrapper.style.position = "";
      wrapper.style.inset = "";
      wrapper.style.zIndex = "";
      wrapper.style.backgroundColor = "";
      wrapper.style.cursor = "";
    }
    transformRef.current = { scale: 1, x: 0, y: 0 };
  }, [currentIndex, imgWrapperRef]);

  useEffect(() => {
    setDisplayScale(1);
  }, [currentIndex]);

  // Wheel zoom (desktop) 

  useEffect(() => {
    const wrapper = imgWrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Ensure base dims
      if (baseDimsRef.current.width === 0) {
        const img = imgRef.current;
        if (img) baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
      }

      const t = transformRef.current;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      if (e.deltaMode === 2) dy *= 100;

      const normalized = Math.max(-100, Math.min(100, dy));
      const step = -(normalized / 100) * 0.05;
      const factor = 1 + step;

      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const clamped = nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);
      setTransform({ scale: nextScale, ...clamped });
    };

    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", handleWheel);
  }, [imgWrapperRef, setTransform, clampTranslate]);

  // Double-click toggle

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // Ensure base dims
      if (baseDimsRef.current.width === 0) {
        const img = imgRef.current;
        if (img) baseDimsRef.current = { width: img.offsetWidth, height: img.offsetHeight };
      }

      if (transformRef.current.scale > 1) {
        resetTransform();
      } else {
        setTransform({ scale: 1.8, x: 0, y: 0 }, true);
      }
    },
    [resetTransform, setTransform]
  );

  return {
    imgRef,
    displayScale,
    isZoomed: displayScale > 1,
    transformRef,
    baseDimsRef,
    resetTransform,
    setTransform,
    applyTransform,
    clampTranslate,
    measureBaseDims,
    handleDoubleClick,
  };
}

export { MIN_SCALE, MAX_SCALE };