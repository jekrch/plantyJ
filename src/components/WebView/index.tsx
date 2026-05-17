import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { LoaderCircle, Maximize2, Search, X, ZoomIn, ZoomOut, Filter } from "lucide-react";
import type {
  AIAnalysis,
  Organism,
  OrganismRecord,
  Relationship,
  RelationshipType,
  Species,
  TaxaInfo,
  Zone,
} from "../../types";
import { effectiveDirection, type RelationshipsData } from "../../hooks/useRelationships";
import { usePanZoom } from "../../hooks/usePanZoom";
import { organismTitle } from "../../utils/display";
import { LEAF_RADIUS } from "../TreeView/types";
import { CtrlBtn } from "../TreeView/CtrlBtn";
import { NodeDetail } from "../TreeView/NodeDetail";
import { buildWebNode } from "./buildWebNode";

interface Props {
  organisms: Organism[];
  organismRecords: OrganismRecord[];
  speciesByShortCode: Map<string, Species>;
  taxa: Record<string, TaxaInfo>;
  zones: Zone[];
  aiAnalyses?: AIAnalysis[];
  relationships: RelationshipsData;
  headerHeight: number;
  onSpotlightOrganism: (shortCode: string) => void;
  onOpenOrganismInList: (organism: Organism, list: Organism[]) => void;
  /** Node code to focus on initial load (decoded from the URL). */
  initialWebNode?: string | null;
  /** Reports the selected node code (or null) so it can be encoded in the URL. */
  onNodeSelect?: (code: string | null) => void;
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
  organism: Organism | undefined;
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

interface SimNode extends SimulationNodeDatum {
  id: string;
}

// Force-directed layout via d3-force. A persistent position cache (keyed by
// node code, owned by the component) seeds the simulation so toggling a
// relationship filter relaxes the existing layout instead of reshuffling it.
function layoutGraph(
  nodes: string[],
  edges: Array<[string, string]>,
  posCache: Map<string, { x: number; y: number }>
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions, width: 1600, height: 1000 };

  if (nodes.length === 1) {
    positions.set(nodes[0], { x: 800, y: 500 });
    posCache.set(nodes[0], { x: 800, y: 500 });
    return { positions, width: 1600, height: 1000 };
  }

  const k = 240; // Ideal link distance (gives edge labels breathing room)
  const minDistance = LEAF_RADIUS * 4 + 60; // Strict anti-collision padding

  // Seed from cache when we've placed this node before; otherwise a
  // deterministic circle (no Math.random — layout stays reproducible).
  let cachedCount = 0;
  const simNodes: SimNode[] = nodes.map((id, i) => {
    const cached = posCache.get(id);
    if (cached) {
      cachedCount++;
      return { id, x: cached.x, y: cached.y };
    }
    const angle = (i / nodes.length) * Math.PI * 2;
    return { id, x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 };
  });
  const hasNode = new Set(nodes);
  const simLinks = edges
    .filter(([a, b]) => hasNode.has(a) && hasNode.has(b))
    .map(([source, target]) => ({ source, target }));

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(k * 1.3)
        .strength(0.4)
    )
    .force("charge", forceManyBody().strength(-3800).distanceMax(1400))
    .force("collide", forceCollide(minDistance).strength(1))
    .force("x", forceX(0).strength(0.03))
    .force("y", forceY(0).strength(0.03))
    .stop();

  // Mostly-cached graph => a filter toggle: relax gently so existing nodes
  // barely move. Fresh graph => full settle from the seed.
  const mostlyCached = cachedCount >= nodes.length * 0.5;
  if (mostlyCached) {
    sim.alpha(0.3).alphaDecay(0.05);
    for (let i = 0; i < 120; i++) sim.tick();
  } else {
    sim.alpha(1).alphaDecay(0.0228);
    for (let i = 0; i < 300; i++) sim.tick();
  }

  for (const n of simNodes) {
    const p = { x: n.x ?? 0, y: n.y ?? 0 };
    positions.set(n.id, p);
    posCache.set(n.id, p);
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

// Geometry for one rendered edge: the curved path plus where/how its type
// label sits. Pulled out of the render so the edge layer and the on-top
// label layer compute identical positions.
function edgeGeometry(e: PositionedEdge) {
  const reverse = e.dir === "bwd";
  const x1 = reverse ? e.toX : e.fromX;
  const y1 = reverse ? e.toY : e.fromY;
  const x2 = reverse ? e.fromX : e.toX;
  const y2 = reverse ? e.fromY : e.toY;
  const directed = e.dir !== "u";

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

  const spread = 60;
  const offset = (e.groupIndex - (e.groupTotal - 1) / 2) * spread;

  const cx = midX + nx * (offset * 2);
  const cy = midY + ny * (offset * 2);

  const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  const textMidX = midX + nx * offset;
  const textMidY = midY + ny * offset;

  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle < -90) angle += 180;

  return { pathD, directed, textMidX, textMidY, angle };
}

function EdgeLabel({
  text,
  x,
  y,
  angle,
  isActive,
  dim,
}: {
  text: string;
  x: number;
  y: number;
  angle: number;
  isActive: boolean;
  dim: boolean;
}) {
  return (
    <g transform={`translate(${x},${y}) rotate(${angle})`} pointerEvents="none">
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
        {text}
      </text>
    </g>
  );
}

export default function WebView({
  organisms,
  organismRecords,
  speciesByShortCode,
  taxa,
  zones,
  aiAnalyses = [],
  relationships,
  headerHeight,
  onSpotlightOrganism,
  onOpenOrganismInList,
  initialWebNode,
  onNodeSelect,
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
    for (const r of organismRecords) {
      const label = r.commonName ?? r.fullName ?? r.shortCode;
      const sub = r.fullName && r.fullName !== label ? r.fullName : null;
      m.set(r.shortCode, { label, sub });
    }
    for (const p of organisms) {
      if (m.has(p.shortCode)) continue;
      const label = p.commonName ?? p.fullName ?? p.shortCode;
      const sub = p.fullName && p.fullName !== label ? p.fullName : null;
      m.set(p.shortCode, { label, sub });
    }
    return m;
  }, [organisms, organismRecords]);

  const organismByCode = useMemo(() => {
    const m = new Map<string, Organism>();
    for (const p of organisms) {
      const existing = m.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        m.set(p.shortCode, p);
      }
    }
    return m;
  }, [organisms]);

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

  // Stable across filter toggles so the graph relaxes instead of reshuffling.
  const posCacheRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const layout = useMemo(() => {
    const { positions, width: layoutWidth, height: layoutHeight } = layoutGraph(
      nodeCodes,
      filteredEdges.map((r) => [r.from, r.to] as [string, string]),
      posCacheRef.current
    );
    
    const nodes: PositionedNode[] = nodeCodes.map((code) => {
      const p = positions.get(code)!;
      const lbl = labelByCode.get(code);
      const organism = organismByCode.get(code);
      return {
        code,
        label: lbl?.label ?? code,
        subLabel: lbl?.sub ?? null,
        x: p.x,
        y: p.y,
        organism,
        isAnimal: organism?.kind === "animal",
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
    organismByCode,
    colorByType,
    relationships.typeById,
  ]);

  const {
    containerRef,
    panRef,
    gestureMovedRef,
    transform,
    ready,
    fitToView,
    zoomBy,
    centerOn,
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
    initialZoom: 0.7,
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

  // Report selection changes upward so they can be encoded in the URL. Skip
  // the mount no-op (null→null) and only fire on an actual change.
  const prevSelected = useRef<string | null>(selectedCode);
  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selectedCode;
    if (prev === selectedCode) return;
    onNodeSelect?.(selectedCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode]);

  // On initial load, focus + select the node named in the URL — the same
  // outcome as picking it from search (centerOn + select, no detail panel).
  const lastFocusedCode = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !initialWebNode) return;
    if (lastFocusedCode.current === initialWebNode) return;
    const node = layout.nodes.find((n) => n.code === initialWebNode);
    if (!node) return;
    lastFocusedCode.current = initialWebNode;
    centerOn(node.x, node.y);
    setSelectedCode(node.code);
    setDetailCode(null);
  }, [ready, layout.nodes, initialWebNode, centerOn]);

  const renderedDetailNode = useMemo(() => {
    if (!renderedDetailCode) return null;
    const organism = organismByCode.get(renderedDetailCode);
    if (!organism) return null;
    return buildWebNode(organism, speciesByShortCode.get(renderedDetailCode));
  }, [renderedDetailCode, organismByCode, speciesByShortCode]);

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
    for (const r of organismRecords) if (!inGraph.has(r.shortCode)) n++;
    return n;
  }, [nodeCodes, organismRecords]);

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

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHi, setSearchHi] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchIndex = useMemo(() => {
    return layout.nodes.map((n) => {
      const fields = [n.label, n.subLabel, n.code, n.organism?.commonName, n.organism?.fullName, n.organism?.variety]
        .filter(Boolean) as string[];
      return { node: n, label: n.label, sublabel: n.subLabel ?? n.code, haystack: fields.join(" \n ").toLowerCase() };
    });
  }, [layout.nodes]);

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as typeof searchIndex;
    const hits: { item: (typeof searchIndex)[number]; score: number }[] = [];
    for (const item of searchIndex) {
      const idx = item.haystack.indexOf(q);
      if (idx === -1) continue;
      hits.push({ item, score: (item.label.toLowerCase().startsWith(q) ? 0 : 1000) + idx });
    }
    hits.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
    return hits.slice(0, 12).map((h) => h.item);
  }, [searchQuery, searchIndex]);

  useEffect(() => { setSearchHi(0); }, [searchMatches]);

  useEffect(() => {
    if (searchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [searchOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setDetailCode(null);
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchHi(0);
  }, []);

  const selectSearchNode = useCallback(
    (node: PositionedNode) => {
      closeSearch();
      centerOn(node.x, node.y);
      setSelectedCode(node.code);
      setDetailCode(null);
    },
    [closeSearch, centerOn]
  );

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSearchHi((i) => Math.min(searchMatches.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSearchHi((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const pick = searchMatches[searchHi] ?? searchMatches[0];
        if (pick) selectSearchNode(pick.node);
      }
    },
    [searchMatches, searchHi, closeSearch, selectSearchNode]
  );

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
          if (gestureMovedRef.current) return;
          setSelectedCode(null);
          setDetailCode(null);
          if (searchOpen) closeSearch();
        }}
      >
        {nodeCodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-ink-muted text-sm font-display tracking-wide">
              NO RELATIONSHIPS YET
            </p>
            <p className="text-[11px] text-ink-faint max-w-md">
              Use /relate &lt;type&gt; &lt;fromCode&gt; &lt;toCode&gt; in Telegram to register a relationship between two organisms.
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
                const isActive = highlightedEdges.has(e.rel.id);
                const dim = activeCode != null && !isActive;
                const opacity = dim ? 0.15 : isActive ? 0.95 : 0.55;
                const width = isActive ? 1.8 : 1.2;
                const g = edgeGeometry(e);

                // When a node is active, highlighted-edge labels are drawn in
                // the top layer (after nodes) so nothing can cover them.
                const labelOnTop = activeCode != null && isActive;

                return (
                  <g key={`edge-${e.rel.id}-${i}`}>
                    <path
                      d={g.pathD}
                      fill="none"
                      stroke={e.color}
                      strokeOpacity={opacity}
                      strokeWidth={width}
                      markerEnd={g.directed ? `url(#web-arr-${e.rel.type})` : undefined}
                    />
                    {!labelOnTop && (
                      <EdgeLabel
                        text={e.typeName}
                        x={g.textMidX}
                        y={g.textMidY}
                        angle={g.angle}
                        isActive={isActive}
                        dim={dim}
                      />
                    )}
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
                    data-node="true"
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
                      if (gestureMovedRef.current) return;
                      
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
                    {n.organism ? (
                      <g clipPath="url(#web-leaf-clip)">
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
                        {n.organism ? organismTitle(n.organism) : n.label}
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

            {/* Top layer: labels of edges touching the active node, drawn
                after the nodes so they're never covered by a node or edge. */}
            {activeCode != null && (
              <g>
                {layout.edges.map((e, i) => {
                  if (!highlightedEdges.has(e.rel.id)) return null;
                  const g = edgeGeometry(e);
                  return (
                    <EdgeLabel
                      key={`top-label-${e.rel.id}-${i}`}
                      text={e.typeName}
                      x={g.textMidX}
                      y={g.textMidY}
                      angle={g.angle}
                      isActive
                      dim={false}
                    />
                  );
                })}
              </g>
            )}
          </svg>
        )}

        {!ready && nodeCodes.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
          </div>
        )}

        {/* Zoom + search controls */}
        <div
          className="absolute bottom-3 left-3 flex flex-col-reverse items-start gap-2"
          onClick={stop}
          onPointerDown={stop}
          onWheel={stop}
        >
          <div className="flex items-center gap-1 rounded-md bg-surface/85 backdrop-blur-sm ring-1 ring-inset ring-white/5 p-1">
            <CtrlBtn
              label="Search"
              active={searchOpen}
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              <Search size={13} strokeWidth={1.5} />
            </CtrlBtn>
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

          {searchOpen && (
            <WebSearchPanel
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchHi={searchHi}
              setSearchHi={setSearchHi}
              matches={searchMatches}
              searchInputRef={searchInputRef}
              closeSearch={closeSearch}
              selectNode={selectSearchNode}
              onKeyDown={onSearchKeyDown}
            />
          )}
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
            {isolatedCount} isolated organism{isolatedCount === 1 ? "" : "s"} hidden
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
              organisms={organisms}
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
              onOpenOrganismInList={onOpenOrganismInList}
              onSpotlightOrganism={onSpotlightOrganism}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Search panel ---

type SearchMatch = { node: PositionedNode; label: string; sublabel: string };

function WebSearchPanel({
  searchQuery,
  setSearchQuery,
  searchHi,
  setSearchHi,
  matches,
  searchInputRef,
  closeSearch,
  selectNode,
  onKeyDown,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchHi: number;
  setSearchHi: (i: number) => void;
  matches: SearchMatch[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  closeSearch: () => void;
  selectNode: (node: PositionedNode) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="w-72 max-w-[80vw] rounded-md bg-surface-raised/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-ink-faint/15">
        <Search size={12} strokeWidth={1.5} className="text-ink-muted shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search species…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={closeSearch}
          className="flex items-center justify-center h-5 w-5 rounded text-ink-muted hover:text-ink hover:bg-white/5 transition-colors shrink-0"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {searchQuery.trim() && (
        <ul className="max-h-72 overflow-y-auto thin-scroll py-1">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-faint italic">No matches</li>
          ) : (
            matches.map((m, i) => (
              <li key={`wsr-${m.node.code}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setSearchHi(i)}
                  onClick={() => selectNode(m.node)}
                  className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 transition-colors ${
                    i === searchHi ? "bg-white/8" : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-[12px] text-ink truncate min-w-0">{m.label}</span>
                  <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-ink-faint shrink-0">
                    {m.sublabel}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}