import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Transform } from "../../hooks/usePanZoom";
import { nodeAt, type Pt } from "./layout";

export interface LiveDrag {
  from: string;
  x: number;
  y: number;
  /** Node currently under the cursor, if it's a valid drop target. */
  over: string | null;
}

/**
 * Drag-from-a-node-to-another-node gesture. Listens on `window` rather than the
 * SVG so a drag that leaves the canvas (or ends over a panel) still resolves,
 * and reads transform/positions through refs so the listeners don't re-bind on
 * every pan frame.
 *
 * A drag that never moved is treated as a click and reports through `onSelect`.
 */
export function useDragConnect({
  containerRef,
  transform,
  positions,
  onConnect,
  onSelect,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  transform: Transform;
  positions: Map<string, Pt>;
  onConnect: (from: string, to: string) => void;
  onSelect: (code: string) => void;
}) {
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const dragRef = useRef<{ from: string; moved: boolean } | null>(null);
  const [live, setLive] = useState<LiveDrag | null>(null);

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = containerRef.current?.getBoundingClientRect();
      const t = transformRef.current;
      const cx = clientX - (rect?.left ?? 0);
      const cy = clientY - (rect?.top ?? 0);
      return { x: (cx - t.x) / t.k, y: (cy - t.y) / t.k };
    },
    [containerRef],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = clientToCanvas(e.clientX, e.clientY);
      d.moved = true;
      const over = nodeAt(p, positionsRef.current);
      setLive({ from: d.from, x: p.x, y: p.y, over: over && over !== d.from ? over : null });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const p = clientToCanvas(e.clientX, e.clientY);
      const over = nodeAt(p, positionsRef.current);
      setLive(null);
      if (d.moved && over && over !== d.from) {
        onConnect(d.from, over);
      } else if (!d.moved) {
        onSelect(d.from);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [clientToCanvas, onConnect, onSelect]);

  const onNodePointerDown = useCallback((e: React.PointerEvent, code: string) => {
    e.stopPropagation();
    dragRef.current = { from: code, moved: false };
    const p = positionsRef.current.get(code);
    setLive({ from: code, x: p?.x ?? 0, y: p?.y ?? 0, over: null });
  }, []);

  return { live, onNodePointerDown };
}
