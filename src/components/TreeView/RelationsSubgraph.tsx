import { useCallback, useMemo, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { Organism, Relationship, RelationshipType } from "../../types";
import { effectiveDirection } from "../../hooks/useRelationships";
import { usePanZoom } from "../../hooks/usePanZoom";
import type { Transform } from "../../hooks/usePanZoom";
import { LEAF_RADIUS } from "./types";
import { CtrlBtn } from "./CtrlBtn";

interface Props {
  centerCode: string;
  centerLabel: string;
  organisms: Organism[];
  relationships: Relationship[];
  neighbors: Map<string, Relationship[]>;
  typeById: Map<string, RelationshipType>;
  organismsByCode: Map<string, Organism>;
  onSelectCode?: (shortCode: string) => void;
  graphClassName?: string;
  outerClassName?: string;
}

const TYPE_COLORS = [
  "var(--color-accent)",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#f87171",
];

const MIN_RING_R = 320;
const NODE_R = LEAF_RADIUS + 2;
const MIN_GAP = 20;
const LABEL_PAD = 60;

interface PositionedNode {
  code: string;
  label: string;
  subLabel: string | null;
  isCenter: boolean;
  x: number;
  y: number;
  organism: Organism | undefined;
  isAnimal: boolean;
}

function organismLabel(p: Organism | undefined, fallback: string): string {
  if (!p) return fallback;
  return p.commonName ?? p.fullName ?? p.shortCode;
}

export function RelationsSubgraph({
  centerCode,
  centerLabel,
  relationships,
  neighbors,
  typeById,
  organismsByCode,
  onSelectCode,
  graphClassName = "relative h-75 overflow-hidden rounded",
  outerClassName = "flex flex-col gap-2",
}: Props) {
  const baseURL = import.meta.env.BASE_URL;
  const [hovered, setHovered] = useState<string | null>(null);

  const colorByType = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const id of typeById.keys()) {
      m.set(id, TYPE_COLORS[i % TYPE_COLORS.length]);
      i++;
    }
    return m;
  }, [typeById]);

  const { nodes, edges, viewboxSize } = useMemo(() => {
    const l1Codes: string[] = [];
    const l1Set = new Set<string>();
    for (const r of neighbors.get(centerCode) ?? []) {
      const other = r.from === centerCode ? r.to : r.from;
      if (other === centerCode || l1Set.has(other)) continue;
      l1Set.add(other);
      l1Codes.push(other);
    }

    const n = l1Codes.length;
    const minChord = 2 * NODE_R + MIN_GAP;
    const ringR = n <= 1
      ? MIN_RING_R
      : Math.max(MIN_RING_R, minChord / (2 * Math.sin(Math.PI / n)));
    const vb = Math.round(2 * (ringR + NODE_R + LABEL_PAD));
    const center = vb / 2;

    const positioned: PositionedNode[] = [];

    const makeNode = (code: string, label: string, isCenter: boolean, x: number, y: number): PositionedNode => {
      const organism = organismsByCode.get(code);
      const sub = organism?.fullName && organism.fullName !== label ? organism.fullName : null;
      return { code, label, subLabel: sub, isCenter, x, y, organism, isAnimal: organism?.kind === "animal" };
    };

    positioned.push(makeNode(centerCode, centerLabel, true, center, center));

    const baseAngle = -Math.PI / 2;
    l1Codes.forEach((code, i) => {
      const angle = baseAngle + (i / Math.max(1, n)) * Math.PI * 2;
      const label = organismLabel(organismsByCode.get(code), code);
      positioned.push(makeNode(code, label, false, center + Math.cos(angle) * ringR, center + Math.sin(angle) * ringR));
    });

    const codeSet = new Set(positioned.map((n) => n.code));
    const seenEdge = new Set<number>();
    const edgesOut: Array<{
      rel: Relationship;
      typeName: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      color: string;
      dir: "fwd" | "bwd" | "u";
    }> = [];
    const posByCode = new Map(positioned.map((n) => [n.code, n]));

    for (const r of relationships) {
      if (!codeSet.has(r.from) || !codeSet.has(r.to)) continue;
      if (seenEdge.has(r.id)) continue;
      seenEdge.add(r.id);
      const a = posByCode.get(r.from)!;
      const b = posByCode.get(r.to)!;
      const dir = effectiveDirection(r, typeById.get(r.type));
      edgesOut.push({
        rel: r,
        typeName: typeById.get(r.type)?.name ?? r.type,
        fromX: a.x,
        fromY: a.y,
        toX: b.x,
        toY: b.y,
        color: colorByType.get(r.type) ?? "var(--color-ink-muted)",
        dir,
      });
    }

    return { nodes: positioned, edges: edgesOut, viewboxSize: vb };
  }, [centerCode, centerLabel, neighbors, relationships, typeById, organismsByCode, colorByType]);

  // When the relations tab is not active the container has display:none (zero size).
  // Detect the transition from hidden → visible and apply the initial fit transform.
  const onContainerResize = useCallback(
    (prev: { w: number; h: number }, next: { w: number; h: number }): Partial<Transform> | null | void => {
      if (prev.w === 0 && next.w > 0) {
        const k = Math.min(next.w / viewboxSize, next.h / viewboxSize, 1);
        return {
          k,
          x: (next.w - viewboxSize * k) / 2,
          y: (next.h - viewboxSize * k) / 2,
        };
      }
      return null;
    },
    [viewboxSize]
  );

  const {
    containerRef,
    panRef,
    fitToView,
    zoomBy,
    transform,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = usePanZoom({
    layoutWidth: viewboxSize,
    layoutHeight: viewboxSize,
    dataReady: nodes.length > 1,
    minK: 0.1,
    maxK: 4,
    onContainerResize,
  });

  const typesInUse = useMemo(() => {
    const ids = new Set(edges.map((e) => e.rel.type));
    return Array.from(ids)
      .map((id) => typeById.get(id))
      .filter((t): t is RelationshipType => !!t);
  }, [edges, typeById]);

  const highlightedEdges = useMemo(() => {
    if (!hovered) return new Set<number>();
    const s = new Set<number>();
    for (const e of edges) {
      if (e.rel.from === hovered || e.rel.to === hovered) s.add(e.rel.id);
    }
    return s;
  }, [edges, hovered]);

  const highlightedNodes = useMemo(() => {
    if (!hovered) return new Set<string>();
    const s = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.rel.from === hovered) s.add(e.rel.to);
      else if (e.rel.to === hovered) s.add(e.rel.from);
    }
    return s;
  }, [edges, hovered]);

  if (nodes.length === 1) {
    return (
      <p className="text-[11px] text-ink-faint italic">
        No relationships defined for this organism. Use /relate in Telegram to add one.
      </p>
    );
  }

  const r = LEAF_RADIUS;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={outerClassName}>
      <div
        ref={containerRef}
        className={graphClassName}
        style={{
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: panRef.current?.moved ? "grabbing" : "grab",
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          width={viewboxSize}
          height={viewboxSize}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            transformOrigin: "0 0",
            display: "block",
            overflow: "visible",
          }}
        >
          <defs>
            <clipPath id="rs-leaf-clip">
              <circle r={r} />
            </clipPath>
            <radialGradient id="rs-leaf-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
            </radialGradient>
            {Array.from(colorByType.entries()).map(([id, color]) => (
              <marker
                key={id}
                id={`rs-arr-${id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={color} />
              </marker>
            ))}
          </defs>

          <g>
            {edges.map((e, i) => {
              const reverse = e.dir === "bwd";
              const x1 = reverse ? e.toX : e.fromX;
              const y1 = reverse ? e.toY : e.fromY;
              const x2 = reverse ? e.fromX : e.toX;
              const y2 = reverse ? e.fromY : e.toY;
              const directed = e.dir !== "u";
              const isActive = highlightedEdges.has(e.rel.id);
              const dim = hovered != null && !isActive;
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;
              const pathD = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;

              let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
              if (angle > 90) angle -= 180;
              else if (angle < -90) angle += 180;

              return (
                <g key={`edge-${e.rel.id}-${i}`}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={e.color}
                    strokeOpacity={dim ? 0.1 : isActive ? 0.95 : 0.55}
                    strokeWidth={isActive ? 1.8 : 1.2}
                    markerEnd={directed ? `url(#rs-arr-${e.rel.type})` : undefined}
                  />
                  <g
                    transform={`translate(${midX},${midY}) rotate(${angle})`}
                    pointerEvents="none"
                  >
                    <text
                      textAnchor="middle"
                      dy={-5}
                      fontFamily="'Space Mono', monospace"
                      fontSize={9}
                      letterSpacing="0.06em"
                      fill={isActive ? "var(--color-ink)" : "var(--color-ink-muted)"}
                      fillOpacity={dim ? 0.15 : isActive ? 1 : 0.85}
                      stroke="var(--color-surface)"
                      strokeWidth={4}
                      strokeOpacity={0.9}
                      paintOrder="stroke fill"
                    >
                      {e.typeName}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          <g>
            {nodes.map((n) => {
              const isCenter = n.isCenter;
              const isActive = n.code === hovered;
              const isNeighbor = hovered != null && highlightedNodes.has(n.code) && !isActive;
              const dim = hovered != null && !isActive && !isNeighbor;
              const nodeColor = n.isAnimal
                ? "var(--color-amber, #f59e0b)"
                : "var(--color-ink)";
              const strokeColor = isActive
                ? nodeColor
                : n.isAnimal
                  ? "rgba(245,158,11,0.6)"
                  : "var(--color-ink-muted)";

              return (
                <g
                  key={`node-${n.code}`}
                  transform={`translate(${n.x},${n.y})`}
                  style={{
                    cursor: !isCenter && onSelectCode ? "pointer" : "default",
                    opacity: dim ? 0.35 : 1,
                    transition: "opacity 160ms ease-out",
                  }}
                  onPointerEnter={() => setHovered(n.code)}
                  onPointerLeave={() => setHovered((h) => (h === n.code ? null : h))}
                  onClick={() => {
                    if (!isCenter && onSelectCode) onSelectCode(n.code);
                  }}
                >
                  <circle r={r + 14} fill="transparent" stroke="none" />
                  {isActive && <circle r={r + 12} fill="url(#rs-leaf-glow)" />}
                  <circle
                    r={r + 2}
                    fill="var(--color-surface)"
                    stroke={strokeColor}
                    strokeOpacity={isActive ? 0.95 : 0.7}
                    strokeWidth={isActive ? 1.8 : isCenter ? 1.8 : 1.2}
                  />
                  {n.organism ? (
                    <g clipPath="url(#rs-leaf-clip)">
                      <image
                        href={`${baseURL}${n.organism.image}`}
                        x={-r}
                        y={-r}
                        width={r * 2}
                        height={r * 2}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </g>
                  ) : (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="'Space Mono', monospace"
                      fontSize={9}
                      fill="var(--color-ink-muted)"
                    >
                      {n.code}
                    </text>
                  )}
                  {isCenter && (
                    <circle
                      r={r + 2}
                      fill="none"
                      stroke={nodeColor}
                      strokeWidth={1.8}
                      strokeOpacity={0.9}
                    />
                  )}
                  <g pointerEvents="none">
                    <text
                      y={r + 14}
                      textAnchor="middle"
                      fontFamily="'DM Sans', sans-serif"
                      fontSize={12}
                      fontWeight={500}
                      fill="var(--color-ink)"
                      stroke="var(--color-surface)"
                      strokeWidth={3}
                      strokeOpacity={0.85}
                      paintOrder="stroke fill"
                    >
                      {n.label}
                    </text>
                    {n.subLabel && (
                      <text
                        y={r + 26}
                        textAnchor="middle"
                        fontFamily="'DM Sans', sans-serif"
                        fontStyle="italic"
                        fontSize={9}
                        fill="var(--color-ink-muted)"
                        stroke="var(--color-surface)"
                        strokeWidth={3}
                        strokeOpacity={0.85}
                        paintOrder="stroke fill"
                      >
                        {n.subLabel}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div
          className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-md bg-surface/85 backdrop-blur-sm ring-1 ring-inset ring-white/5 p-0.5"
          onClick={stop}
          onPointerDown={stop}
          onWheel={stop}
        >
          <CtrlBtn label="Zoom out" onClick={() => zoomBy(0.8)}>
            <ZoomOut size={13} strokeWidth={1.5} />
          </CtrlBtn>
          <CtrlBtn label="Zoom in" onClick={() => zoomBy(1.25)}>
            <ZoomIn size={13} strokeWidth={1.5} />
          </CtrlBtn>
          <CtrlBtn label="Fit to view" onClick={fitToView}>
            <Maximize2 size={13} strokeWidth={1.5} />
          </CtrlBtn>
        </div>
      </div>

      {typesInUse.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
          {typesInUse.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-ink-muted"
              title={t.description}
            >
              <span
                className="inline-block w-2.5 h-px"
                style={{ background: colorByType.get(t.id), height: "2px" }}
              />
              {t.name}
              {t.directional ? (
                <span className="text-ink-faint">→</span>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
