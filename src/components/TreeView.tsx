import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { hierarchy, cluster, type HierarchyPointNode } from "d3-hierarchy";
import { Sprout, ZoomIn, ZoomOut, Maximize2, LoaderCircle } from "lucide-react";
import type { Plant, Species } from "../types";
import { plantTitle } from "../utils/display";

const RANKS = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
] as const;

type Rank = (typeof RANKS)[number] | "root";

interface RawNode {
  name: string;
  rank: Rank;
  shortCode?: string;
  plant?: Plant;
  children?: RawNode[];
}

interface Props {
  plants: Plant[];
  speciesByShortCode: Map<string, Species>;
  headerHeight: number;
  onOpenPlantInList: (plant: Plant, list: Plant[]) => void;
  onSpotlightPlant: (shortCode: string) => void;
}

function speciesPicsFor(plants: Plant[], shortCode: string): Plant[] {
  return plants
    .filter((p) => p.shortCode === shortCode)
    .sort(
      (a, b) =>
        new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
}

const LEAF_RADIUS = 22;
const NODE_RADIUS_BASE = 4;
const ROW_HEIGHT = 64;
const COL_WIDTH = 150;
const LABEL_COL = 220;
const PAD_X = 60;
const PAD_Y = 56;

const RANK_LABEL: Record<Rank, string> = {
  root: "Life",
  kingdom: "Kingdom",
  phylum: "Phylum",
  class: "Class",
  order: "Order",
  family: "Family",
  genus: "Genus",
  species: "Species",
};

function buildTree(
  plants: Plant[],
  speciesByShortCode: Map<string, Species>
): { root: RawNode; missing: Plant[] } {
  // Pick the most-recent pic per shortCode as the species "representative" image.
  const repByShortCode = new Map<string, Plant>();
  for (const p of plants) {
    const existing = repByShortCode.get(p.shortCode);
    if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
      repByShortCode.set(p.shortCode, p);
    }
  }

  const root: RawNode = { name: "Tree of Life", rank: "root", children: [] };
  const missing: Plant[] = [];

  for (const [shortCode, plant] of repByShortCode) {
    const sp = speciesByShortCode.get(shortCode);
    const tax = sp?.taxonomy;
    if (!tax) {
      missing.push(plant);
      continue;
    }
    const path: { name: string; rank: Rank }[] = [];
    for (const rank of RANKS) {
      const v = tax[rank];
      if (v) path.push({ name: v, rank });
    }
    if (path.length === 0) {
      missing.push(plant);
      continue;
    }

    let cur = root;
    path.forEach((seg, i) => {
      const isLeaf = i === path.length - 1;
      cur.children = cur.children ?? [];
      let child = cur.children.find((c) => c.name === seg.name);
      if (!child) {
        child = {
          name: seg.name,
          rank: seg.rank,
          children: isLeaf ? undefined : [],
        };
        cur.children.push(child);
      }
      if (isLeaf) {
        child.shortCode = plant.shortCode;
        child.plant = plant;
      }
      cur = child;
    });
  }

  // Sort children alphabetically at each level for stable layout.
  function sortRec(n: RawNode) {
    if (!n.children) return;
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of n.children) sortRec(c);
  }
  sortRec(root);

  return { root, missing };
}

// Draw a hand-drawn-ish smooth bezier between two points (left → right tree).
function linkPath(
  src: { x: number; y: number },
  dst: { x: number; y: number }
): string {
  const mx = (src.y + dst.y) / 2;
  return `M${src.y},${src.x} C${mx},${src.x} ${mx},${dst.x} ${dst.y},${dst.x}`;
}

export default function TreeView({
  plants,
  speciesByShortCode,
  headerHeight,
  onOpenPlantInList,
  onSpotlightPlant,
}: Props) {
  const { root } = useMemo(
    () => buildTree(plants, speciesByShortCode),
    [plants, speciesByShortCode]
  );

  const layout = useMemo(() => {
    const h = hierarchy<RawNode>(root, (d) => d.children);
    const leaves = h.leaves().length;
    const depth = Math.max(h.height, 1);
    // Force uniform spacing between leaves regardless of tree topology so
    // siblings can never crowd closer than ROW_HEIGHT.
    const height = Math.max((leaves - 1) * ROW_HEIGHT, 200);
    const treeWidth = depth * COL_WIDTH;
    cluster<RawNode>()
      .size([height, treeWidth])
      .separation(() => 1)(h);
    const nodes = h.descendants() as HierarchyPointNode<RawNode>[];
    const links = h.links() as {
      source: HierarchyPointNode<RawNode>;
      target: HierarchyPointNode<RawNode>;
    }[];
    // Per-rank header positions: median y of all nodes at that rank.
    const rankCols = new Map<Rank, number>();
    for (const rank of RANKS) {
      const ys = nodes
        .filter((n) => n.data.rank === rank)
        .map((n) => n.y);
      if (ys.length > 0) {
        ys.sort((a, b) => a - b);
        rankCols.set(rank, ys[Math.floor(ys.length / 2)]);
      }
    }
    return {
      nodes,
      links,
      rankCols,
      treeWidth,
      width: PAD_X * 2 + treeWidth + LEAF_RADIUS + LABEL_COL,
      height: height + PAD_Y * 2,
    };
  }, [root]);

  // Pan / zoom state.
  const [transform, setTransform] = useState({ x: 0, y: PAD_Y, k: 1 });
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<HierarchyPointNode<RawNode> | null>(
    null
  );
  const [pinned, setPinned] = useState<HierarchyPointNode<RawNode> | null>(
    null
  );
  const [renderedPinned, setRenderedPinned] = useState<HierarchyPointNode<RawNode> | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Sync `pinned` to `renderedPinned`
  useEffect(() => {
    if (pinned) {
      setRenderedPinned(pinned);
      setIsClosing(false);
    } else if (renderedPinned) {
      setIsClosing(true);
    }
  }, [pinned, renderedPinned]);

  const containerRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { cx: number; cy: number }>>(
    new Map()
  );
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

  const clientToContainer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { cx: clientX, cy: clientY };
      const rect = el.getBoundingClientRect();
      return { cx: clientX - rect.left, cy: clientY - rect.top };
    },
    []
  );

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return false;
    const k = Math.min(cw / layout.width, ch / layout.height, 1);
    const x = (cw - layout.width * k) / 2;
    const y = (ch - layout.height * k) / 2;
    setTransform({ x, y, k });
    return true;
  }, [layout.width, layout.height]);

  // Run the initial fit synchronously before paint so the user never sees
  // the un-fitted (zoomed-in, top-left) frame.
  useLayoutEffect(() => {
    if (fitToView()) setReady(true);
  }, [fitToView]);

  useEffect(() => {
    const onResize = () => fitToView();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitToView]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30) {
        // allow page scroll for shallow vertical scrolls without modifier
      }
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
        return {
          k,
          x: mx - (mx - t.x) * ratio,
          y: my - (my - t.y) * ratio,
        };
      });
    },
    []
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const { cx, cy } = clientToContainer(e.clientX, e.clientY);
      pointersRef.current.set(e.pointerId, { cx, cy });

      if (pointersRef.current.size === 1) {
        // Single pointer → defer capture until movement so child clicks survive.
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
        // Promote to pinch — capture both pointers immediately.
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
        const k = Math.min(4, Math.max(0.2, rawK));
        const ratio = k / pinch.startK;
        // Scale around the original midpoint, then translate by midpoint drift
        // so two-finger drag also pans.
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
    [clientToContainer]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}

      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      if (panRef.current && panRef.current.pointerId === e.pointerId) {
        panRef.current = null;
      }
      if (pointersRef.current.size === 1) {
        // Pinch ended with a finger still down — resume panning from here.
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

  const activeNode = pinned ?? hovered;
  const baseURL = import.meta.env.BASE_URL;

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-10 flex flex-col"
      style={{ top: headerHeight }}
    >
      <div
        ref={containerRef}
        className="relative w-full flex-1 min-h-0 bg-surface-raised/30 overflow-hidden tree-canvas"
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
        onClick={(e) => {
          // Click on background (not a node) clears pin.
          if (e.target === e.currentTarget) setPinned(null);
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
            transformOrigin: "0 0",
            display: "block",
            opacity: ready ? 1 : 0,
            transition: "opacity 220ms ease-out",
          }}
        >
          <defs>
            <clipPath id="leaf-clip">
              <circle r={LEAF_RADIUS} />
            </clipPath>
            <radialGradient id="leaf-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g transform={`translate(${PAD_X},${PAD_Y})`}>
            {/* Column headers along the top */}
            <g className="tree-column-headers" pointerEvents="none">
              {RANKS.map((rank) => {
                const x = layout.rankCols.get(rank);
                if (x === undefined) return null;
                return (
                  <text
                    key={`hdr-${rank}`}
                    x={x}
                    y={-PAD_Y / 2 - 6}
                    textAnchor="middle"
                    fontFamily="'Space Mono', monospace"
                    fontSize={10}
                    letterSpacing="0.18em"
                    fill="var(--color-ink-muted)"
                  >
                    {RANK_LABEL[rank].toUpperCase()}
                  </text>
                );
              })}
            </g>

            {/* Connectors */}
            <g className="tree-links" fill="none" strokeLinecap="round">
              {layout.links.map((l, i) => {
                const isActive =
                  activeNode &&
                  (l.target === activeNode ||
                    l.target.ancestors().includes(activeNode));
                return (
                  <path
                    key={i}
                    d={linkPath(l.source, l.target)}
                    stroke={
                      isActive ? "var(--color-accent)" : "var(--color-ink-muted)"
                    }
                    strokeOpacity={isActive ? 0.95 : 0.55}
                    strokeWidth={isActive ? 1.8 : 1.1}
                  />
                );
              })}
            </g>

            {/* Internal node names — every node above species */}
            <g className="tree-internal-labels" pointerEvents="none">
              {layout.nodes
                .filter((n) => n.depth > 0 && !n.data.plant)
                .map((n) => {
                  const isActive =
                    n === activeNode ||
                    (activeNode && activeNode.ancestors().includes(n));
                  return (
                    <text
                      key={`il-${n.data.rank}-${n.data.name}-${n.depth}`}
                      x={n.y}
                      y={n.x - 10}
                      textAnchor="middle"
                      fontFamily="'Space Mono', monospace"
                      fontSize={11}
                      fill={
                        isActive
                          ? "var(--color-accent)"
                          : "var(--color-ink)"
                      }
                      fillOpacity={isActive ? 1 : 0.85}
                      stroke="var(--color-surface)"
                      strokeWidth={3}
                      strokeOpacity={0.85}
                      paintOrder="stroke fill"
                    >
                      {n.data.name}
                    </text>
                  );
                })}
            </g>

            {/* Nodes */}
            <g className="tree-nodes">
              {layout.nodes.map((n) => {
                const isLeaf = !!n.data.plant;
                const isActive = n === activeNode;
                const isAncestorOfActive =
                  activeNode && activeNode.ancestors().includes(n);
                const cx = n.y;
                const cy = n.x;

                if (isLeaf) {
                  const p = n.data.plant!;
                  const r = LEAF_RADIUS;
                  const title = plantTitle(p);
                  const binomial = p.fullName;
                  return (
                    <g
                      key={`leaf-${p.id}`}
                      transform={`translate(${cx},${cy})`}
                      style={{ cursor: "pointer" }}
                      onPointerEnter={() => setHovered(n)}
                      onPointerLeave={() =>
                        setHovered((h) => (h === n ? null : h))
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (panRef.current?.moved) return;
                        onOpenPlantInList(p, speciesPicsFor(plants, p.shortCode));
                      }}
                    >
                      {isActive && (
                        <circle r={r + 12} fill="url(#leaf-glow)" />
                      )}
                      <circle
                        r={r + 2}
                        fill="var(--color-surface)"
                        stroke={
                          isActive
                            ? "var(--color-accent)"
                            : "var(--color-ink-muted)"
                        }
                        strokeOpacity={isActive ? 0.95 : 0.7}
                        strokeWidth={isActive ? 1.8 : 1.2}
                      />
                      <g clipPath="url(#leaf-clip)">
                        <image
                          href={`${baseURL}${p.image}`}
                          x={-r}
                          y={-r}
                          width={r * 2}
                          height={r * 2}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      </g>

                      {/* Right-side label */}
                      <g>
                        <text
                          x={r + 10}
                          y={-4}
                          textAnchor="start"
                          dominantBaseline="middle"
                          fontFamily="'DM Sans', sans-serif"
                          fontSize={12}
                          fontWeight={500}
                          fill="var(--color-ink)"
                          stroke="var(--color-surface)"
                          strokeWidth={3}
                          strokeOpacity={0.85}
                          paintOrder="stroke fill"
                        >
                          {title}
                        </text>
                        {binomial && binomial !== title && (
                          <text
                            x={r + 10}
                            y={9}
                            textAnchor="start"
                            dominantBaseline="middle"
                            fontFamily="'DM Sans', sans-serif"
                            fontStyle="italic"
                            fontSize={10}
                            fill="var(--color-ink-muted)"
                            stroke="var(--color-surface)"
                            strokeWidth={3}
                            strokeOpacity={0.85}
                            paintOrder="stroke fill"
                          >
                            {binomial}
                          </text>
                        )}
                      </g>
                    </g>
                  );
                }

                // Internal nodes
                const isRoot = n.depth === 0;
                const branching = (n.children?.length ?? 0) > 1;
                const r = isRoot
                  ? 6
                  : branching
                  ? NODE_RADIUS_BASE
                  : NODE_RADIUS_BASE - 1.5;
                return (
                  <g
                    key={`int-${n.data.rank}-${n.data.name}-${n.depth}`}
                    transform={`translate(${cx},${cy})`}
                    style={{ cursor: branching ? "pointer" : "default" }}
                    onPointerEnter={() => setHovered(n)}
                    onPointerLeave={() =>
                      setHovered((h) => (h === n ? null : h))
                    }
                    onClick={(e) => {
                      if (!branching && !isRoot) return;
                      e.stopPropagation();
                      if (panRef.current?.moved) return;
                      setPinned((cur) => (cur === n ? null : n));
                    }}
                  >
                    <circle r={r + 6} fill="transparent" stroke="none" />
                    <circle
                      r={r}
                      fill={
                        isActive || isAncestorOfActive
                          ? "var(--color-accent)"
                          : "var(--color-ink-muted)"
                      }
                      fillOpacity={isActive || isAncestorOfActive ? 1 : 0.75}
                    />
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
          </div>
        )}

        {/* Floating control bar */}
        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-md bg-surface/85 backdrop-blur-sm ring-1 ring-inset ring-white/5 p-1">
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

        {/* Hint */}
        {/* <p className="absolute bottom-3 left-3 text-[10px] font-mono text-ink-faint/70 pointer-events-none">
          drag to pan · scroll/pinch to zoom · click a leaf to open · click a node to expand
        </p> */}
      </div>

      {/* Pinned detail panel */}
      {renderedPinned && (
        <NodeDetail
          node={renderedPinned}
          plants={plants}
          isClosing={isClosing}
          onAnimationEnd={() => {
            if (isClosing) setRenderedPinned(null);
          }}
          onClose={() => setPinned(null)}
          onOpenPlantInList={onOpenPlantInList}
          onSpotlightPlant={onSpotlightPlant}
        />
      )}
    </div>
  );
}

function CtrlBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center h-7 w-7 rounded text-ink-muted hover:text-accent hover:bg-white/5 transition-colors"
    >
      {children}
    </button>
  );
}

function NodeDetail({
  node,
  plants,
  isClosing,
  onAnimationEnd,
  onClose,
  onOpenPlantInList,
  onSpotlightPlant,
}: {
  node: HierarchyPointNode<RawNode>;
  plants: Plant[];
  isClosing?: boolean;
  onAnimationEnd?: () => void;
  onClose: () => void;
  onOpenPlantInList: (plant: Plant, list: Plant[]) => void;
  onSpotlightPlant: (shortCode: string) => void;
}) {
  const isLeaf = !!node.data.plant;
  const baseURL = import.meta.env.BASE_URL;

  // Collect all leaf shortCodes under this node.
  const shortCodes = useMemo(() => {
    const set = new Set<string>();
    node.descendants().forEach((d) => {
      if (d.data.shortCode) set.add(d.data.shortCode);
    });
    return set;
  }, [node]);

  // For leaf: show all pics for that shortCode. For internal: one rep per shortCode.
  const items = useMemo(() => {
    if (isLeaf) {
      const code = node.data.shortCode!;
      return plants
        .filter((p) => p.shortCode === code)
        .sort(
          (a, b) =>
            new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
        );
    }
    const repByCode = new Map<string, Plant>();
    for (const p of plants) {
      if (!shortCodes.has(p.shortCode)) continue;
      const existing = repByCode.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        repByCode.set(p.shortCode, p);
      }
    }
    return Array.from(repByCode.values()).sort((a, b) =>
      plantTitle(a).localeCompare(plantTitle(b))
    );
  }, [isLeaf, node, plants, shortCodes]);

  const ancestry = node
    .ancestors()
    .reverse()
    .filter((n) => n.depth > 0);

  const title = isLeaf ? plantTitle(node.data.plant!) : node.data.name;
  const subtitle = isLeaf
    ? node.data.plant?.fullName
    : RANK_LABEL[node.data.rank];

  return (
    <div 
      className={`${isClosing ? "slide-down-out" : "slide-up-in"} bg-surface-raised border-t border-ink-faint/30 p-3 max-h-[45vh] overflow-y-auto shrink-0 thin-scroll`}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-display text-ink leading-tight">
              {title}
            </h3>
            {subtitle && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint">
                {subtitle}
              </span>
            )}
          </div>
          {ancestry.length > 0 && (
            <p className="text-[10px] font-mono text-ink-faint mt-1 truncate">
              {ancestry.map((a) => a.data.name).join(" › ")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] font-mono uppercase tracking-wider text-ink-muted hover:text-accent transition-colors shrink-0"
        >
          close
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-ink-faint">No images yet.</p>
      ) : (
        <div className="columns-3 sm:columns-4 md:columns-5 lg:columns-6 gap-1.5">
          {items.map((p) => {
            const aspect =
              p.width && p.height ? `${p.width} / ${p.height}` : "3 / 4";
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  onOpenPlantInList(p, speciesPicsFor(plants, p.shortCode))
                }
                className="panel-item relative overflow-hidden rounded-sm bg-surface ring-1 ring-inset ring-white/5 hover:ring-accent/40 transition-all break-inside-avoid mb-1.5 block w-full"
                style={{ aspectRatio: aspect }}
              >
                <img
                  src={`${baseURL}${p.image}`}
                  alt={plantTitle(p)}
                  loading="lazy"
                  decoding="async"
                  className="block w-full h-full object-cover"
                  draggable={false}
                />
                {!isLeaf && (
                  <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white/85 bg-linear-to-t from-black/80 to-black/20 leading-tight truncate pointer-events-none">
                    {plantTitle(p)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isLeaf && node.data.shortCode && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onSpotlightPlant(node.data.shortCode!)}
            className="flex items-center gap-1.5 text-[11px] font-display tracking-wider uppercase text-accent hover:text-accent-dim transition-colors"
          >
            <Sprout size={12} strokeWidth={1.5} />
            Spotlight this plant
          </button>
        </div>
      )}
    </div>
  );
}
