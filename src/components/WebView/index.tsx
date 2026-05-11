import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Maximize2, ZoomIn, ZoomOut, Filter } from "lucide-react";
import type {
  AIAnalysis,
  Plant,
  PlantRecord,
  Relationship,
  RelationshipType,
  Species,
  TaxaInfo,
  Zone,
} from "../../types";
import { effectiveDirection, type RelationshipsData } from "../../hooks/useRelationships";
import { usePanZoom } from "../../hooks/usePanZoom";
import { plantTitle } from "../../utils/display";
import { LEAF_RADIUS } from "../TreeView/types";
import { CtrlBtn } from "../TreeView/CtrlBtn";
import { NodeDetail } from "../TreeView/NodeDetail";
import { buildWebNode } from "./buildWebNode";

interface Props {
  plants: Plant[];
  plantRecords: PlantRecord[];
  speciesByShortCode: Map<string, Species>;
  taxa: Record<string, TaxaInfo>;
  zones: Zone[];
  aiAnalyses?: AIAnalysis[];
  relationships: RelationshipsData;
  headerHeight: number;
  onSpotlightPlant: (shortCode: string) => void;
  onOpenPlantInList: (plant: Plant, list: Plant[]) => void;
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

interface PositionedNode {
  code: string;
  label: string;
  subLabel: string | null;
  x: number;
  y: number;
  plant: Plant | undefined;
  isAnimal: boolean;
}

interface PositionedEdge {
  rel: Relationship;
  typeName: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  dir: "fwd" | "bwd" | "u";
  groupIndex: number;
  groupTotal: number;
}

// Organic force-directed layout without artificial bounding box constraints.
function layoutGraph(
  nodes: string[],
  edges: Array<[string, string]>
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions, width: 1600, height: 1000 };

  // Initialize in a tight cluster near 0,0
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = 200 * Math.random();
    positions.set(n, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });

  if (nodes.length === 1) {
    positions.get(nodes[0])!.x = 800;
    positions.get(nodes[0])!.y = 500;
    return { positions, width: 1600, height: 1000 };
  }

  const iterations = 350;
  const k = 200; // Fixed ideal distance between connected nodes (allows edge text breathing room)
  let temp = k * 2;
  const minDistance = LEAF_RADIUS * 4 + 60; // Strict anti-collision padding
  const gravity = 0.35; // Gentle pull toward origin to keep separate clusters from flying away

  for (let it = 0; it < iterations; it++) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const n of nodes) disp.set(n, { x: 0, y: 0 });

    for (let i = 0; i < nodes.length; i++) {
      const a = positions.get(nodes[i])!;
      const da = disp.get(nodes[i])!;

      // Apply center gravity
      da.x -= a.x * gravity;
      da.y -= a.y * gravity;

      for (let j = i + 1; j < nodes.length; j++) {
        const b = positions.get(nodes[j])!;
        const db = disp.get(nodes[j])!;
        
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);
        
        if (dist < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = Math.hypot(dx, dy);
        }

        let force = (k * k) / dist;
        if (dist < minDistance) {
           // Aggressive repulsion if nodes physically overlap
           force += Math.pow(minDistance - dist, 2);
        }

        const ux = dx / dist;
        const uy = dy / dist;
        
        da.x += ux * force;
        da.y += uy * force;
        db.x -= ux * force;
        db.y -= uy * force;
      }
    }

    for (const [u, v] of edges) {
      const a = positions.get(u);
      const b = positions.get(v);
      if (!a || !b) continue;
      
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let dist = Math.hypot(dx, dy);
      
      if (dist < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        dist = Math.hypot(dx, dy);
      }

      const force = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      
      const da = disp.get(u)!;
      const db = disp.get(v)!;
      da.x -= ux * force;
      da.y -= uy * force;
      db.x += ux * force;
      db.y += uy * force;
    }

    // Apply displacement without artificial walls
    for (const n of nodes) {
      const d = disp.get(n)!;
      const dlen = Math.max(0.01, Math.hypot(d.x, d.y));
      const p = positions.get(n)!;
      p.x += (d.x / dlen) * Math.min(dlen, temp);
      p.y += (d.y / dlen) * Math.min(dlen, temp);
    }
    temp *= 0.98;
  }

  // Measure the final organic size of the graph
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  positions.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });

  if (maxX === minX) maxX += 10;
  if (maxY === minY) maxY += 10;

  // Find the densest node (the one with the most relationships) to use as our focal point
  const degrees = new Map<string, number>();
  nodes.forEach((n) => degrees.set(n, 0));
  edges.forEach(([u, v]) => {
    degrees.set(u, (degrees.get(u) || 0) + 1);
    degrees.set(v, (degrees.get(v) || 0) + 1);
  });

  let densestNode = nodes[0];
  let maxDegree = -1;
  degrees.forEach((deg, n) => {
    if (deg > maxDegree) {
      maxDegree = deg;
      densestNode = n;
    }
  });

  // Create a fixed virtual canvas size. By making this smaller than the 
  // graph's maximum bounding box, the pan/zoom hook will start in a naturally 
  // zoomed-in state.
  const width = 1600;
  const height = 1000;

  // Center the densest cluster in the middle of our view
  const cx = densestNode && positions.has(densestNode) ? positions.get(densestNode)!.x : (minX + maxX) / 2;
  const cy = densestNode && positions.has(densestNode) ? positions.get(densestNode)!.y : (minY + maxY) / 2;
  
  const targetCx = width / 2;
  const targetCy = height / 2;
  
  // Shift the graph cluster so our focal point centers in our viewport
  const offsetX = targetCx - cx;
  const offsetY = targetCy - cy;

  positions.forEach(p => {
    p.x += offsetX;
    p.y += offsetY;
  });

  return { positions, width, height };
}

export default function WebView({
  plants,
  plantRecords,
  speciesByShortCode,
  taxa,
  zones,
  aiAnalyses = [],
  relationships,
  headerHeight,
  onSpotlightPlant,
  onOpenPlantInList,
}: Props) {
  const baseURL = import.meta.env.BASE_URL;

  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(
    () => new Set(relationships.types.map((t) => t.id))
  );
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  useEffect(() => {
    setEnabledTypes(new Set(relationships.types.map((t) => t.id)));
  }, [relationships.types]);

  const labelByCode = useMemo(() => {
    const m = new Map<string, { label: string; sub: string | null }>();
    for (const r of plantRecords) {
      const label = r.commonName ?? r.fullName ?? r.shortCode;
      const sub = r.fullName && r.fullName !== label ? r.fullName : null;
      m.set(r.shortCode, { label, sub });
    }
    for (const p of plants) {
      if (m.has(p.shortCode)) continue;
      const label = p.commonName ?? p.fullName ?? p.shortCode;
      const sub = p.fullName && p.fullName !== label ? p.fullName : null;
      m.set(p.shortCode, { label, sub });
    }
    return m;
  }, [plants, plantRecords]);

  const plantByCode = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of plants) {
      const existing = m.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        m.set(p.shortCode, p);
      }
    }
    return m;
  }, [plants]);

  const colorByType = useMemo(() => {
    const m = new Map<string, string>();
    relationships.types.forEach((t, i) => {
      m.set(t.id, TYPE_COLORS[i % TYPE_COLORS.length]);
    });
    return m;
  }, [relationships.types]);

  const { nodeCodes, filteredEdges } = useMemo(() => {
    const edges = relationships.relationships.filter((r) =>
      enabledTypes.has(r.type)
    );
    const codes = new Set<string>();
    for (const r of edges) {
      codes.add(r.from);
      codes.add(r.to);
    }
    return {
      nodeCodes: Array.from(codes).sort(),
      filteredEdges: edges,
    };
  }, [relationships.relationships, enabledTypes]);

  const layout = useMemo(() => {
    const { positions, width: layoutWidth, height: layoutHeight } = layoutGraph(
      nodeCodes,
      filteredEdges.map((r) => [r.from, r.to] as [string, string])
    );
    
    const nodes: PositionedNode[] = nodeCodes.map((code) => {
      const p = positions.get(code)!;
      const lbl = labelByCode.get(code);
      const plant = plantByCode.get(code);
      return {
        code,
        label: lbl?.label ?? code,
        subLabel: lbl?.sub ?? null,
        x: p.x,
        y: p.y,
        plant,
        isAnimal: plant?.kind === "animal",
      };
    });

    // First map to base edge structure
    const rawEdges = filteredEdges.map((r) => {
      const a = positions.get(r.from)!;
      const b = positions.get(r.to)!;
      const dir = effectiveDirection(r, relationships.typeById.get(r.type));
      return {
        rel: r,
        typeName: relationships.typeById.get(r.type)?.name ?? r.type,
        fromX: a.x,
        fromY: a.y,
        toX: b.x,
        toY: b.y,
        color: colorByType.get(r.type) ?? "var(--color-ink-muted)",
        dir,
      };
    });

    // Group edges by their node pair to calculate bundles for rendering
    const edgeGroups = new Map<string, typeof rawEdges>();
    for (const e of rawEdges) {
      // Sort to group A->B and B->A into the same visual pair
      const pairId = [e.rel.from, e.rel.to].sort().join("|");
      if (!edgeGroups.has(pairId)) edgeGroups.set(pairId, []);
      edgeGroups.get(pairId)!.push(e);
    }

    const edges: PositionedEdge[] = [];
    for (const group of edgeGroups.values()) {
      group.forEach((e, i) => {
        edges.push({
          ...e,
          groupIndex: i,
          groupTotal: group.length,
        });
      });
    }

    return { nodes, edges, layoutWidth, layoutHeight };
  }, [
    nodeCodes,
    filteredEdges,
    labelByCode,
    plantByCode,
    colorByType,
    relationships.typeById,
  ]);

  const {
    containerRef,
    panRef,
    transform,
    ready,
    fitToView,
    zoomBy,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = usePanZoom({
    layoutWidth: layout.layoutWidth,
    layoutHeight: layout.layoutHeight,
    dataReady: relationships.loaded && nodeCodes.length > 0,
    minK: 0.1,
    maxK: 4,
  });

  const [hovered, setHovered] = useState<string | null>(null);
  
  // Selection vs Detail States
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [renderedDetailCode, setRenderedDetailCode] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [selectBurstKey, setSelectBurstKey] = useState(0);

  // Trigger burst animation purely on selection change
  useEffect(() => {
    if (selectedCode) setSelectBurstKey((k) => k + 1);
  }, [selectedCode]);

  // Handle viewer animation mount/unmount
  useEffect(() => {
    if (detailCode) {
      setRenderedDetailCode(detailCode);
      setIsClosing(false);
    } else if (renderedDetailCode) {
      setIsClosing(true);
    }
  }, [detailCode, renderedDetailCode]);

  // If filters drop the selected node out of the graph, reset states
  useEffect(() => {
    if (selectedCode && !nodeCodes.includes(selectedCode)) {
      setSelectedCode(null);
      setDetailCode(null);
    }
  }, [selectedCode, nodeCodes]);

  const renderedDetailNode = useMemo(() => {
    if (!renderedDetailCode) return null;
    const plant = plantByCode.get(renderedDetailCode);
    if (!plant) return null;
    return buildWebNode(plant, speciesByShortCode.get(renderedDetailCode));
  }, [renderedDetailCode, plantByCode, speciesByShortCode]);

  const activeCode = selectedCode ?? hovered;

  // Highlight edges + neighbor nodes touching the active node.
  const highlightedEdges = useMemo(() => {
    if (!activeCode) return new Set<number>();
    const s = new Set<number>();
    for (const e of layout.edges) {
      if (e.rel.from === activeCode || e.rel.to === activeCode) s.add(e.rel.id);
    }
    return s;
  }, [layout.edges, activeCode]);

  const highlightedNodes = useMemo(() => {
    if (!activeCode) return new Set<string>();
    const s = new Set<string>([activeCode]);
    for (const e of layout.edges) {
      if (e.rel.from === activeCode) s.add(e.rel.to);
      else if (e.rel.to === activeCode) s.add(e.rel.from);
    }
    return s;
  }, [layout.edges, activeCode]);

  const isolatedCount = useMemo(() => {
    const inGraph = new Set(nodeCodes);
    let n = 0;
    for (const r of plantRecords) if (!inGraph.has(r.shortCode)) n++;
    return n;
  }, [nodeCodes, plantRecords]);

  const toggleType = (id: string) => {
    setEnabledTypes((prev) => {
      if (prev.size === relationships.types.length) {
        return new Set([id]);
      }
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        return new Set(relationships.types.map((t) => t.id));
      }
      return next;
    });
  };

  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  if (!relationships.loaded) {
    return (
      <div
        className="fixed left-0 right-0 bottom-0 flex items-center justify-center text-ink-muted text-sm"
        style={{ top: headerHeight }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-10 flex flex-col"
      style={{ top: headerHeight }}
    >
      <div
        ref={containerRef}
        className="relative w-full flex-1 min-h-0 bg-surface-raised/30 overflow-hidden"
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
        onClick={() => {
          if (panRef.current?.moved) return;
          setSelectedCode(null);
          setDetailCode(null);
        }}
      >
        {nodeCodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-ink-muted text-sm font-display tracking-wide">
              NO RELATIONSHIPS YET
            </p>
            <p className="text-[11px] text-ink-faint max-w-md">
              Use /relate &lt;type&gt; &lt;fromCode&gt; &lt;toCode&gt; in Telegram to register a relationship between two plants.
            </p>
          </div>
        ) : (
          <svg
            width={layout.layoutWidth}
            height={layout.layoutHeight}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
              transformOrigin: "0 0",
              display: "block",
              opacity: ready ? 1 : 0,
              transition: "opacity 220ms ease-out",
              overflow: "visible",
            }}
          >
            <defs>
              <clipPath id="web-leaf-clip">
                <circle r={LEAF_RADIUS} />
              </clipPath>
              <radialGradient id="web-leaf-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.45" />
                <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
              </radialGradient>
              {Array.from(colorByType.entries()).map(([id, color]) => (
                <marker
                  key={id}
                  id={`web-arr-${id}`}
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
              {layout.edges.map((e, i) => {
                const reverse = e.dir === "bwd";
                const x1 = reverse ? e.toX : e.fromX;
                const y1 = reverse ? e.toY : e.fromY;
                const x2 = reverse ? e.fromX : e.toX;
                const y2 = reverse ? e.fromY : e.toY;
                const directed = e.dir !== "u";
                const isActive = highlightedEdges.has(e.rel.id);
                const dim = activeCode != null && !isActive;
                const opacity = dim ? 0.15 : isActive ? 0.95 : 0.55;
                const width = isActive ? 1.8 : 1.2;

                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                const isFromSmaller = e.rel.from < e.rel.to;
                const normX1 = isFromSmaller ? e.fromX : e.toX;
                const normY1 = isFromSmaller ? e.fromY : e.toY;
                const normX2 = isFromSmaller ? e.toX : e.fromX;
                const normY2 = isFromSmaller ? e.toY : e.fromY;

                const baseDx = normX2 - normX1;
                const baseDy = normY2 - normY1;
                const baseLen = Math.max(0.01, Math.hypot(baseDx, baseDy));
                const nx = -baseDy / baseLen;
                const ny = baseDx / baseLen;

                const spread = 40; 
                const offset = (e.groupIndex - (e.groupTotal - 1) / 2) * spread;

                const cx = midX + nx * (offset * 2);
                const cy = midY + ny * (offset * 2);

                const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

                const textMidX = midX + nx * offset;
                const textMidY = midY + ny * offset;

                let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
                if (angle > 90) angle -= 180;
                else if (angle < -90) angle += 180;

                return (
                  <g key={`edge-${e.rel.id}-${i}`}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={e.color}
                      strokeOpacity={opacity}
                      strokeWidth={width}
                      markerEnd={directed ? `url(#web-arr-${e.rel.type})` : undefined}
                    />
                    <g
                      transform={`translate(${textMidX},${textMidY}) rotate(${angle})`}
                      pointerEvents="none"
                    >
                      <text
                        textAnchor="middle"
                        dy={-5}
                        fontFamily="'Space Mono', monospace"
                        fontSize={9}
                        letterSpacing="0.06em"
                        fill={isActive ? "var(--color-ink)" : "var(--color-ink-muted)"}
                        fillOpacity={dim ? 0.2 : isActive ? 1 : 0.85}
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
              {layout.nodes.map((n) => {
                const isSelected = n.code === selectedCode;
                const isActive = n.code === activeCode;
                const isNeighbor =
                  activeCode != null && highlightedNodes.has(n.code) && !isActive;
                const dim =
                  activeCode != null && !isActive && !isNeighbor;
                const r = LEAF_RADIUS;
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
                    key={`web-node-${n.code}`}
                    transform={`translate(${n.x},${n.y})`}
                    style={{
                      cursor: "pointer",
                      opacity: dim ? 0.35 : 1,
                      transition: "opacity 160ms ease-out",
                    }}
                    onPointerEnter={() => setHovered(n.code)}
                    onPointerLeave={() =>
                      setHovered((h) => (h === n.code ? null : h))
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (panRef.current?.moved) return;
                      
                      if (selectedCode === n.code) {
                        setDetailCode((cur) => (cur === n.code ? null : n.code));
                      } else {
                        setSelectedCode(n.code);
                        setDetailCode(null);
                      }
                    }}
                  >
                    <circle
                      r={r + 14}
                      fill="transparent"
                      stroke="none"
                    />
                    {isSelected && (
                      <circle
                        key={`burst-${selectBurstKey}-${n.code}`}
                        r={r + 14}
                        fill="url(#web-leaf-glow)"
                        className="node-select-burst"
                      />
                    )}
                    {isSelected && (
                      <circle
                        r={r + 16}
                        fill="none"
                        stroke={nodeColor}
                        strokeWidth={1.2}
                        className="node-halo-persist"
                      />
                    )}
                    {isActive && !isSelected && (
                      <circle r={r + 12} fill="url(#web-leaf-glow)" />
                    )}
                    <circle
                      r={r + 2}
                      fill="var(--color-surface)"
                      stroke={strokeColor}
                      strokeOpacity={isActive ? 0.95 : 0.7}
                      strokeWidth={isActive ? 1.8 : 1.2}
                    />
                    {n.plant ? (
                      <g clipPath="url(#web-leaf-clip)">
                        <image
                          href={`${baseURL}${n.plant.image}`}
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
                        fontSize={10}
                        fill="var(--color-ink-muted)"
                      >
                        {n.code}
                      </text>
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
                        {n.plant ? plantTitle(n.plant) : n.label}
                      </text>
                      {n.subLabel && (
                        <text
                          y={r + 28}
                          textAnchor="middle"
                          fontFamily="'DM Sans', sans-serif"
                          fontStyle="italic"
                          fontSize={10}
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
        )}

        {!ready && nodeCodes.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
          </div>
        )}

        {/* Zoom controls */}
        <div
          className="absolute bottom-3 left-3 flex flex-col-reverse items-start gap-2"
          onClick={stop}
          onPointerDown={stop}
          onWheel={stop}
        >
          <div className="flex items-center gap-1 rounded-md bg-surface/85 backdrop-blur-sm ring-1 ring-inset ring-white/5 p-1">
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

        {/* Type filter chips */}
        {relationships.types.length > 0 && (
          <div
            className="absolute top-3 left-3 flex flex-col gap-2 max-w-[calc(100%-1.5rem)]"
            onClick={stop}
            onPointerDown={stop}
            onWheel={stop}
          >
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              className="inline-flex items-center gap-2 px-3 py-1.5 w-max bg-surface/85 backdrop-blur-sm border border-white/10 text-[10px] font-mono uppercase tracking-[0.15em] text-ink-muted hover:text-ink transition-colors rounded-sm"
            >
              <Filter size={12} strokeWidth={1.5} />
              <span>Relationships</span>
              {enabledTypes.size !== relationships.types.length && (
                <span className="text-ink">({enabledTypes.size})</span>
              )}
            </button>

            {filtersExpanded && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-surface/85 backdrop-blur-sm border border-white/5 rounded-sm max-w-md">
                {relationships.types.map((t: RelationshipType) => {
                  const active = enabledTypes.has(t.id);
                  const color = colorByType.get(t.id) ?? "var(--color-ink-muted)";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      title={t.description}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm text-[10px] font-mono uppercase tracking-wider transition-colors ${
                        active
                          ? "bg-white/5 border-white/10 text-ink"
                          : "bg-transparent border-transparent text-ink-faint hover:text-ink-muted hover:bg-white/5"
                      }`}
                    >
                      <span
                        className="inline-block w-2.5"
                        style={{ background: color, height: "2px", opacity: active ? 1 : 0.3 }}
                      />
                      {t.name}
                      {t.directional ? <span className="text-ink-faint">→</span> : null}
                    </button>
                  );
                })}
                
                {enabledTypes.size !== relationships.types.length && (
                  <button
                    onClick={() => setEnabledTypes(new Set(relationships.types.map((t) => t.id)))}
                    className="inline-flex items-center gap-1.5 px-2 py-1 ml-1 text-[10px] font-mono uppercase tracking-wider text-ink-faint hover:text-ink transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isolatedCount > 0 && nodeCodes.length > 0 && (
          <div className="absolute bottom-3 right-3 text-[10px] font-mono text-ink-faint">
            {isolatedCount} isolated plant{isolatedCount === 1 ? "" : "s"} hidden
          </div>
        )}
      </div>

      {renderedDetailNode && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div
            className="w-full max-w-3xl pointer-events-auto"
            onWheel={stop}
            onClick={stop}
            onPointerDown={stop}
          >
            <NodeDetail
              node={renderedDetailNode}
              plants={plants}
              taxa={taxa}
              zones={zones}
              speciesByShortCode={speciesByShortCode}
              aiAnalyses={aiAnalyses}
              relationships={relationships}
              isClosing={isClosing}
              onAnimationEnd={() => {
                if (isClosing) setRenderedDetailCode(null);
              }}
              onClose={() => setDetailCode(null)}
              onOpenPlantInList={onOpenPlantInList}
              onSpotlightPlant={onSpotlightPlant}
            />
          </div>
        </div>
      )}
    </div>
  );
}