import { useCallback, useRef } from "react";
import type { ZoomPanState } from "./useZoomPan";
import type { SlideNavigationState } from "./useSlideNavigation";

interface GestureHandlers {
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
}

interface PanGesture {
  isDragging: boolean;
  pointerStart: { x: number; y: number };
  translateStart: { x: number; y: number };
  pinchStartDist: number | null;
  pinchStartScale: number;
  pinchMidpoint: { x: number; y: number } | null;
  lastTouchPos: { x: number; y: number } | null;
}

interface SlideGesture {
  active: boolean;
  startX: number;
  startY: number;
  startTime: number;
  locked: boolean;
  rejected: boolean;
}

/**
 * Coordinates zoom/pan and slide gestures, routing pointer and touch events
 * to the appropriate behavior based on current zoom state.
 *
 * When zoomed (scale > 1): pointer/touch drags are pans.
 * When unzoomed (scale === 1): pointer/touch drags are slide-to-navigate.
 * Two-finger touch is always a pinch-zoom.
 */
export function useGestureHandler(
  zoomPan: ZoomPanState,
  slide: SlideNavigationState,
  hasPrev: boolean,
  hasNext: boolean
): GestureHandlers {
  const { transformRef, clampTranslate, setTransform, applyTransform, resetTransform } = zoomPan;
  const { applySlideOffset, resolveSlide, snapBack, setSlideActive, swipeOffsetRef } = slide;

  const panRef = useRef<PanGesture>({
    isDragging: false,
    pointerStart: { x: 0, y: 0 },
    translateStart: { x: 0, y: 0 },
    pinchStartDist: null,
    pinchStartScale: 1,
    pinchMidpoint: null,
    lastTouchPos: null,
  });

  const slideRef = useRef<SlideGesture>({
    active: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    locked: false,
    rejected: false,
  });

  // Double-tap detection for touch
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  // Shared slide start helper

  const beginSlide = useCallback(
    (x: number, y: number) => {
      setSlideActive(true);
      const sg = slideRef.current;
      sg.active = true;
      sg.startX = x;
      sg.startY = y;
      sg.startTime = Date.now();
      sg.locked = false;
      sg.rejected = false;
    },
    [setSlideActive]
  );

  const updateSlide = useCallback(
    (clientX: number, clientY: number, lockThreshold: number, angleBias: number) => {
      const sg = slideRef.current;
      if (!sg.active || sg.rejected) return;

      const dx = clientX - sg.startX;
      const dy = clientY - sg.startY;

      if (!sg.locked) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < lockThreshold && absDy < lockThreshold) return;
        if (absDy > absDx * angleBias) {
          sg.rejected = true;
          return;
        }
        sg.locked = true;
      }

      let offset = dx;
      if ((offset > 0 && !hasPrev) || (offset < 0 && !hasNext)) {
        offset *= 0.2; // rubber-band resistance at edges
      }
      applySlideOffset(offset);
    },
    [hasPrev, hasNext, applySlideOffset]
  );

  const endSlide = useCallback(
    (allowResolve: boolean) => {
      const sg = slideRef.current;
      if (sg.active && sg.locked && !sg.rejected && allowResolve) {
        const startTime = sg.startTime;
        sg.active = false;
        resolveSlide(startTime);
      } else {
        sg.active = false;
        if (swipeOffsetRef.current === 0) setSlideActive(false);
      }
    },
    [resolveSlide, setSlideActive, swipeOffsetRef]
  );

  // Pointer (mouse) handlers 

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;

      if (transformRef.current.scale > 1) {
        e.preventDefault();
        const p = panRef.current;
        p.isDragging = true;
        p.pointerStart = { x: e.clientX, y: e.clientY };
        p.translateStart = { x: transformRef.current.x, y: transformRef.current.y };
      } else {
        beginSlide(e.clientX, e.clientY);
      }
    },
    [transformRef, beginSlide]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;

      const p = panRef.current;
      if (p.isDragging && transformRef.current.scale > 1) {
        const dx = e.clientX - p.pointerStart.x;
        const dy = e.clientY - p.pointerStart.y;
        const t = transformRef.current;
        const clamped = clampTranslate(p.translateStart.x + dx, p.translateStart.y + dy, t.scale);
        setTransform({ scale: t.scale, ...clamped });
        return;
      }

      // Mouse slide: lockThreshold=4, angleBias=1 (45° cutoff)
      updateSlide(e.clientX, e.clientY, 4, 1);
    },
    [transformRef, clampTranslate, setTransform, updateSlide]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      panRef.current.isDragging = false;
      endSlide(true);
    },
    [endSlide]
  );

  // Touch handlers

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const p = panRef.current;

      if (e.touches.length === 2) {
        // Pinch start
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        p.pinchStartDist = Math.hypot(dx, dy);
        p.pinchStartScale = transformRef.current.scale;
        p.pinchMidpoint = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
        p.lastTouchPos = null;

        // Cancel any slide in progress
        if (slideRef.current.active) {
          slideRef.current.active = false;
          snapBack();
        }
      } else if (e.touches.length === 1) {
        if (transformRef.current.scale > 1) {
          p.lastTouchPos = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        } else {
          beginSlide(e.touches[0].clientX, e.touches[0].clientY);
        }
      }
    },
    [transformRef, snapBack, beginSlide]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const p = panRef.current;

      if (e.touches.length === 2 && p.pinchStartDist !== null) {
        // Pinch zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / p.pinchStartDist;
        const nextScale = Math.min(5, Math.max(1, p.pinchStartScale * ratio));
        const t = transformRef.current;
        const clamped = nextScale <= 1 ? { x: 0, y: 0 } : clampTranslate(t.x, t.y, nextScale);

        const next = { scale: nextScale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
        // Sync display state for UI
        // (We set displayScale indirectly through setTransform would cause extra work,
        // so we just write to transformRef + applyTransform, and let touchEnd sync.)
      } else if (e.touches.length === 1 && p.lastTouchPos && transformRef.current.scale > 1) {
        // Zoomed pan
        const touch = e.touches[0];
        const dx = touch.clientX - p.lastTouchPos.x;
        const dy = touch.clientY - p.lastTouchPos.y;
        p.lastTouchPos = { x: touch.clientX, y: touch.clientY };

        const t = transformRef.current;
        const clamped = clampTranslate(t.x + dx, t.y + dy, t.scale);
        const next = { scale: t.scale, ...clamped };
        transformRef.current = next;
        applyTransform(next);
      } else if (e.touches.length === 1) {
        // Touch slide: lockThreshold=6, angleBias=0.8
        const touch = e.touches[0];
        updateSlide(touch.clientX, touch.clientY, 6, 0.8);
      }
    },
    [transformRef, clampTranslate, applyTransform, updateSlide]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const p = panRef.current;
      const wasPinch = p.pinchStartDist !== null;
      p.pinchStartDist = null;
      p.pinchMidpoint = null;

      if (e.touches.length === 0 && transformRef.current.scale <= 1) {
        // Resolve slide if active
        const sg = slideRef.current;
        if (sg.active && sg.locked && !sg.rejected) {
          const startTime = sg.startTime;
          sg.active = false;
          resolveSlide(startTime);
          transformRef.current = { scale: 1, x: 0, y: 0 };
          return;
        }
        sg.active = false;
        resetTransform();
      }

      // One finger remaining after pinch → start pan from that finger
      if (e.touches.length === 1 && transformRef.current.scale > 1) {
        p.lastTouchPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else {
        p.lastTouchPos = null;
      }

      // Double-tap detection (single finger, not after pinch, not after slide)
      const sg = slideRef.current;
      if (e.touches.length === 0 && e.changedTouches.length === 1 && !wasPinch && !sg.locked) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        const timeDelta = now - last.time;
        const distDelta = Math.hypot(touch.clientX - last.x, touch.clientY - last.y);

        if (timeDelta < 300 && distDelta < 30) {
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          if (transformRef.current.scale > 1) {
            resetTransform();
          } else {
            setTransform({ scale: 2.5, x: 0, y: 0 }, true);
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        }
      }

      // Cleanup slide if released without committing
      if (e.touches.length === 0 && sg.active && !sg.locked) {
        sg.active = false;
        if (swipeOffsetRef.current === 0) setSlideActive(false);
      }
    },
    [transformRef, resetTransform, setTransform, resolveSlide, setSlideActive, swipeOffsetRef]
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}