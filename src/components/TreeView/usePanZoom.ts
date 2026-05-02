import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PAD_X, PAD_Y, INITIAL_ZOOM_FACTOR } from "./types";

interface PanZoomOptions {
  layoutWidth: number;
  layoutHeight: number;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export function usePanZoom({ layoutWidth, layoutHeight }: PanZoomOptions) {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: PAD_Y, k: 1 });
  const [ready, setReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { cx: number; cy: number }>>(new Map());
  const panRef = useRef<{
    pointerId: number;
    startCX: number;
    startCY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startMidCX: number;
    startMidCY: number;
    startK: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  const clientToContainer = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { cx: clientX, cy: clientY };
    const rect = el.getBoundingClientRect();
    return { cx: clientX - rect.left, cy: clientY - rect.top };
  }, []);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return false;
    const k = Math.min(cw / layoutWidth, ch / layoutHeight, 1);
    const x = (cw - layoutWidth * k) / 2;
    const y = (ch - layoutHeight * k) / 2;
    setTransform({ x, y, k });
    return true;
  }, [layoutWidth, layoutHeight]);

  const initialView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return false;
    const fitK = Math.min(cw / layoutWidth, ch / layoutHeight, 1);
    const k = Math.min(4, Math.max(0.2, fitK * INITIAL_ZOOM_FACTOR));
    const scaledW = layoutWidth * k;
    // Right-align so species labels sit at the right edge; top-align for rank headers.
    const x = scaledW <= cw ? (cw - scaledW) / 2 : cw - scaledW + 60;
    const y = 0;
    setTransform({ x, y, k });
    return true;
  }, [layoutWidth, layoutHeight]);

  // Run the initial fit synchronously before paint so the user never sees the un-fitted frame.
  useLayoutEffect(() => {
    if (initialView()) setReady(true);
  }, [initialView]);

  // Keep the right edge anchored when the container resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let prevWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const newWidth = el.clientWidth;
      const delta = newWidth - prevWidth;
      prevWidth = newWidth;
      if (delta !== 0) setTransform((t) => ({ ...t, x: t.x + delta }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    setTransform((t) => {
      const k = Math.min(4, Math.max(0.2, t.k * factor));
      const ratio = k / t.k;
      return {
        k,
        x: cw / 2 - (cw / 2 - t.x) * ratio,
        y: ch / 2 - (ch / 2 - t.y) * ratio,
      };
    });
  }, []);

  const focusOnPoint = useCallback(
    (nodeX: number, nodeY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      setTransform((t) => {
        const svgX = PAD_X + nodeY;
        const svgY = PAD_Y + nodeX;
        const y = Math.min(0, ch * (1 / 3) - svgY * t.k);
        return { k: t.k, x: cw * (2 / 3) - svgX * t.k, y };
      });
    },
    []
  );

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setTransform((t) => {
      const k = Math.min(4, Math.max(0.2, t.k * factor));
      const ratio = k / t.k;
      return { k, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const { cx, cy } = clientToContainer(e.clientX, e.clientY);
      pointersRef.current.set(e.pointerId, { cx, cy });

      if (pointersRef.current.size === 1) {
        pinchRef.current = null;
        panRef.current = {
          pointerId: e.pointerId,
          startCX: cx,
          startCY: cy,
          origX: transform.x,
          origY: transform.y,
          moved: false,
        };
      } else if (pointersRef.current.size === 2) {
        panRef.current = null;
        const target = e.currentTarget as HTMLElement;
        for (const id of pointersRef.current.keys()) {
          try { target.setPointerCapture(id); } catch {}
        }
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[1].cx - pts[0].cx;
        const dy = pts[1].cy - pts[0].cy;
        pinchRef.current = {
          startDist: Math.max(1, Math.hypot(dx, dy)),
          startMidCX: (pts[0].cx + pts[1].cx) / 2,
          startMidCY: (pts[0].cy + pts[1].cy) / 2,
          startK: transform.k,
          startTx: transform.x,
          startTy: transform.y,
        };
      }
    },
    [transform.x, transform.y, transform.k, clientToContainer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      const { cx, cy } = clientToContainer(e.clientX, e.clientY);
      pointersRef.current.set(e.pointerId, { cx, cy });

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const pts = Array.from(pointersRef.current.values()).slice(0, 2);
        const dx = pts[1].cx - pts[0].cx;
        const dy = pts[1].cy - pts[0].cy;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const midCX = (pts[0].cx + pts[1].cx) / 2;
        const midCY = (pts[0].cy + pts[1].cy) / 2;
        const rawK = pinch.startK * (dist / pinch.startDist);
        const k = Math.min(4, Math.max(0.2, rawK));
        const ratio = k / pinch.startK;
        // Scale around original midpoint, then translate by midpoint drift for two-finger drag.
        const x = midCX - (pinch.startMidCX - pinch.startTx) * ratio;
        const y = midCY - (pinch.startMidCY - pinch.startTy) * ratio;
        setTransform({ x, y, k });
        return;
      }

      const p = panRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const dx = cx - p.startCX;
      const dy = cy - p.startCY;
      if (!p.moved && Math.hypot(dx, dy) > 4) {
        p.moved = true;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
      }
      if (!p.moved) return;
      setTransform((t) => ({ ...t, x: p.origX + dx, y: p.origY + dy }));
    },
    [clientToContainer]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (panRef.current?.pointerId === e.pointerId) panRef.current = null;

      if (pointersRef.current.size === 1) {
        // Pinch ended with a finger still down — resume panning from here.
        let remId = -1;
        let remPos = { cx: 0, cy: 0 };
        for (const [id, pos] of pointersRef.current) { remId = id; remPos = pos; }
        panRef.current = {
          pointerId: remId,
          startCX: remPos.cx,
          startCY: remPos.cy,
          origX: transform.x,
          origY: transform.y,
          moved: true,
        };
      }
    },
    [transform.x, transform.y]
  );

  return {
    containerRef,
    panRef,
    transform,
    ready,
    fitToView,
    focusOnPoint,
    zoomBy,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
