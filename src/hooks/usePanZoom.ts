import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface PanZoomOptions {
  layoutWidth: number;
  layoutHeight: number;
  dataReady: boolean;
  minK?: number;
  maxK?: number;
  // Compute the initial transform once layout + container are measured.
  // Defaults to a centered fit-to-view.
  initialTransform?: (cw: number, ch: number, lw: number, lh: number) => Transform;
  // Optional resize hook. Receives previous and current container sizes plus
  // the current transform and may return a partial transform to merge in.
  onContainerResize?: (
    prev: { w: number; h: number },
    next: { w: number; h: number },
    current: Transform
  ) => Partial<Transform> | null | void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const defaultInitial = (cw: number, ch: number, lw: number, lh: number): Transform => {
  if (!cw || !ch) return { x: 0, y: 0, k: 1 };
  const k = Math.min(cw / lw, ch / lh, 1);
  return {
    x: (cw - lw * k) / 2,
    y: (ch - lh * k) / 2,
    k,
  };
};

export function usePanZoom({
  layoutWidth,
  layoutHeight,
  dataReady,
  minK = 0.1,
  maxK = 4,
  initialTransform = defaultInitial,
  onContainerResize,
}: PanZoomOptions) {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [ready, setReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

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
    setTransform({
      k,
      x: (cw - layoutWidth * k) / 2,
      y: (ch - layoutHeight * k) / 2,
    });
    return true;
  }, [layoutWidth, layoutHeight]);

  const applyInitial = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return false;
    setTransform(initialTransform(cw, ch, layoutWidth, layoutHeight));
    return true;
  }, [initialTransform, layoutWidth, layoutHeight]);

  useLayoutEffect(() => {
    if (!dataReady) return;
    if (applyInitial()) setReady(true);
  }, [applyInitial, dataReady]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let prev = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      if (next.w === prev.w && next.h === prev.h) return;
      if (onContainerResize) {
        const update = onContainerResize(prev, next, transformRef.current);
        if (update) setTransform((t) => ({ ...t, ...update }));
      }
      prev = next;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onContainerResize]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      setTransform((t) => {
        const k = clamp(t.k * factor, minK, maxK);
        const ratio = k / t.k;
        return {
          k,
          x: cw / 2 - (cw / 2 - t.x) * ratio,
          y: ch / 2 - (ch / 2 - t.y) * ratio,
        };
      });
    },
    [minK, maxK]
  );

  // Center the viewport on a point in layout coordinates, preserving zoom.
  const centerOn = useCallback((svgX: number, svgY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    setTransform((t) => ({
      k: t.k,
      x: cw / 2 - svgX * t.k,
      y: ch / 2 - svgY * t.k,
    }));
  }, []);

  const setTransformDirect = useCallback((updater: (t: Transform) => Transform) => {
    setTransform(updater);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform((t) => {
        const k = clamp(t.k * factor, minK, maxK);
        const ratio = k / t.k;
        return { k, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio };
      });
    },
    [minK, maxK]
  );

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
          try {
            target.setPointerCapture(id);
          } catch {}
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
        const k = clamp(rawK, minK, maxK);
        const ratio = k / pinch.startK;
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
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }
      if (!p.moved) return;
      setTransform((t) => ({ ...t, x: p.origX + dx, y: p.origY + dy }));
    },
    [clientToContainer, minK, maxK]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}

      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (panRef.current?.pointerId === e.pointerId) panRef.current = null;

      if (pointersRef.current.size === 1) {
        let remId = -1;
        let remPos = { cx: 0, cy: 0 };
        for (const [id, pos] of pointersRef.current) {
          remId = id;
          remPos = pos;
        }
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
    applyInitial,
    zoomBy,
    centerOn,
    setTransform: setTransformDirect,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
