import { useCallback } from "react";
import { usePanZoom as useGenericPanZoom, type Transform } from "../../hooks/usePanZoom";
import { PAD_X, PAD_Y, INITIAL_ZOOM_FACTOR } from "./types";

export type { Transform };

interface PanZoomOptions {
  layoutWidth: number;
  layoutHeight: number;
  dataReady: boolean;
}

export function usePanZoom({ layoutWidth, layoutHeight, dataReady }: PanZoomOptions) {
  // Tree-specific initial view: right-align species column and top-align rank headers,
  // then zoom past fit-to-view by INITIAL_ZOOM_FACTOR.
  const initialTransform = useCallback(
    (cw: number, ch: number, lw: number, _lh: number) => {
      const fitK = Math.min(cw / lw, ch / _lh, 1);
      const k = Math.min(4, Math.max(0.2, fitK * INITIAL_ZOOM_FACTOR));
      const scaledW = lw * k;
      const x = scaledW <= cw ? (cw - scaledW) / 2 : cw - scaledW + 60;
      const y = 0;
      return { x, y, k };
    },
    []
  );

  // Keep the right edge anchored when the container resizes.
  const onContainerResize = useCallback(
    (prev: { w: number; h: number }, next: { w: number; h: number }, current: Transform) => {
      const delta = next.w - prev.w;
      if (delta === 0) return null;
      return { x: current.x + delta };
    },
    []
  );

  const base = useGenericPanZoom({
    layoutWidth,
    layoutHeight,
    dataReady,
    minK: 0.2,
    maxK: 4,
    initialTransform,
    onContainerResize,
  });

  // Tree-specific focusOnPoint: 1/6 from left, 1/4 from top, floored at the
  // right-aligned x so we never pull the species column further left than fit.
  const focusOnPoint = useCallback(
    (nodeX: number, nodeY: number) => {
      const el = base.containerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      base.setTransform((t) => {
        const svgX = PAD_X + nodeY;
        const svgY = PAD_Y + nodeX;
        const scaledW = layoutWidth * t.k;
        const rightAlignedX = scaledW <= cw ? (cw - scaledW) / 2 : cw - scaledW + 60;
        const desiredX = cw * (1 / 6) - svgX * t.k;
        const x = Math.max(desiredX, rightAlignedX);
        const y = Math.min(0, ch * (1 / 4) - svgY * t.k);
        return { k: t.k, x, y };
      });
    },
    [base, layoutWidth]
  );

  return {
    containerRef: base.containerRef,
    panRef: base.panRef,
    transform: base.transform,
    ready: base.ready,
    fitToView: base.fitToView,
    focusOnPoint,
    zoomBy: base.zoomBy,
    onWheel: base.onWheel,
    onPointerDown: base.onPointerDown,
    onPointerMove: base.onPointerMove,
    onPointerUp: base.onPointerUp,
  };
}
