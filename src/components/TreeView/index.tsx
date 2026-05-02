import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, cluster, type HierarchyPointNode } from "d3-hierarchy";
import { LoaderCircle, Maximize2, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { plantTitle } from "../../utils/display";
import { buildTree, linkPath } from "./treeUtils";
import { usePanZoom } from "./usePanZoom";
import { useTreeSearch } from "./useTreeSearch";
import { NodeDetail } from "./NodeDetail";
import { CtrlBtn } from "./CtrlBtn";
import {
  RANKS,
  RANK_LABEL,
  LEAF_RADIUS,
  NODE_RADIUS_BASE,
  ROW_HEIGHT,
  COL_WIDTH,
  LABEL_COL,
  PAD_X,
  PAD_Y,
} from "./types";
import type { Props, RawNode } from "./types";

export default function TreeView({
  plants,
  speciesByShortCode,
  taxa,
  headerHeight,
  onOpenPlantInList,
  onSpotlightPlant,
  initialTreeNode,
  onNodeSelect,
}: Props) {
  const baseURL = import.meta.env.BASE_URL;

  const { root } = useMemo(
    () => buildTree(plants, speciesByShortCode),
    [plants, speciesByShortCode]
  );

  const layout = useMemo(() => {
    const h = hierarchy<RawNode>(root, (d) => d.children);
    const leaves = h.leaves().length;
    const depth = Math.max(h.height, 1);
    const height = Math.max((leaves - 1) * ROW_HEIGHT, 200);
    const treeWidth = depth * COL_WIDTH;
    cluster<RawNode>().size([height, treeWidth]).separation(() => 1)(h);
    const nodes = h.descendants() as HierarchyPointNode<RawNode>[];
    const links = h.links() as {
      source: HierarchyPointNode<RawNode>;
      target: HierarchyPointNode<RawNode>;
    }[];
    const rankCols = new Map<(typeof RANKS)[number], number>();
    for (const rank of RANKS) {
      const ys = nodes.filter((n) => n.data.rank === rank).map((n) => n.y);
      if (ys.length > 0) {
        ys.sort((a, b) => a - b);
        rankCols.set(rank, ys[Math.floor(ys.length / 2)]);
      }
    }
    return {
      nodes,
      links,
      rankCols,
      width: PAD_X * 2 + treeWidth + LEAF_RADIUS + LABEL_COL,
      height: height + PAD_Y * 2,
    };
  }, [root]);

  const [hovered, setHovered] = useState<HierarchyPointNode<RawNode> | null>(null);
  const [pinned, setPinned] = useState<HierarchyPointNode<RawNode> | null>(null);
  const [renderedPinned, setRenderedPinned] = useState<HierarchyPointNode<RawNode> | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [pinnedKey, setPinnedKey] = useState(0);

  useEffect(() => {
    if (pinned) {
      setPinnedKey((k) => k + 1);
      setRenderedPinned(pinned);
      setIsClosing(false);
    } else if (renderedPinned) {
      setIsClosing(true);
    }
  }, [pinned, renderedPinned]);

  const {
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
  } = usePanZoom({ layoutWidth: layout.width, layoutHeight: layout.height });

  const focusNode = useCallback(
    (n: HierarchyPointNode<RawNode>) => {
      focusOnPoint(n.x, n.y);
      setPinned(n);
    },
    [focusOnPoint]
  );

  const prevPinned = useRef<typeof pinned>(pinned);
  useEffect(() => {
    const prev = prevPinned.current;
    prevPinned.current = pinned;
    // Only sync when the selection actually changed (skip mount no-op null→null)
    if (prev === pinned) return;
    if (prev === null && pinned === null) return;
    onNodeSelect?.(pinned?.data.name ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  const lastFocusedName = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !initialTreeNode) return;
    if (lastFocusedName.current === initialTreeNode) return;
    const node = layout.nodes.find((n) => n.data.name === initialTreeNode);
    if (!node) return;
    lastFocusedName.current = initialTreeNode;
    focusNode(node);
  }, [ready, layout.nodes, initialTreeNode, focusNode]);

  // When layout is recomputed (e.g. species data reloads in Strict Mode), the node
  // objects are new references. Re-sync pinned to the matching node so highlights stay.
  useEffect(() => {
    if (!pinned) return;
    const fresh = layout.nodes.find((n) => n.data.name === pinned.data.name);
    if (fresh && fresh !== pinned) setPinned(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.nodes]);

  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchHi,
    setSearchHi,
    matches,
    searchInputRef,
    closeSearch,
    selectSearchItem,
    onSearchKeyDown,
  } = useTreeSearch(layout.nodes, focusNode, () => setPinned(null));

  const activeNode = pinned ?? hovered;

  const makeNodeHandlers = useCallback(
    (n: HierarchyPointNode<RawNode>) => ({
      onPointerEnter: () => setHovered(n),
      onPointerLeave: () => setHovered((h) => (h === n ? null : h)),
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (panRef.current?.moved) return;
        setPinned((cur) => (cur === n ? null : n));
      },
    }),
    [panRef]
  );

  return (
    <div className="fixed left-0 right-0 bottom-0 z-10 flex flex-col" style={{ top: headerHeight }}>
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
        onClick={() => {
          setPinned(null);
          if (searchOpen) closeSearch();
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
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <g transform={`translate(${PAD_X},${PAD_Y})`}>
            <RankHeaders rankCols={layout.rankCols} />
            <TreeLinks links={layout.links} activeNode={activeNode} />
            <InternalLabels nodes={layout.nodes} activeNode={activeNode} />
            <TreeNodes
              nodes={layout.nodes}
              activeNode={activeNode}
              pinned={pinned}
              pinnedKey={pinnedKey}
              baseURL={baseURL}
              makeNodeHandlers={makeNodeHandlers}
            />
          </g>
        </svg>

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
          </div>
        )}

        <div
          className="absolute bottom-3 left-3 flex flex-col-reverse items-start gap-2"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
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
            <SearchPanel
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchHi={searchHi}
              setSearchHi={setSearchHi}
              matches={matches}
              searchInputRef={searchInputRef}
              closeSearch={closeSearch}
              selectSearchItem={selectSearchItem}
              onSearchKeyDown={onSearchKeyDown}
            />
          )}
        </div>
      </div>

      {renderedPinned && (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div
            className="w-full max-w-3xl pointer-events-auto"
            onWheel={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <NodeDetail
              node={renderedPinned}
              plants={plants}
              taxa={taxa}
              speciesByShortCode={speciesByShortCode}
              isClosing={isClosing}
              onAnimationEnd={() => { if (isClosing) setRenderedPinned(null); }}
              onClose={() => setPinned(null)}
              onOpenPlantInList={onOpenPlantInList}
              onSpotlightPlant={onSpotlightPlant}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- SVG sub-components ---

function RankHeaders({
  rankCols,
}: {
  rankCols: Map<(typeof RANKS)[number], number>;
}) {
  return (
    <g className="tree-column-headers" pointerEvents="none">
      {RANKS.map((rank) => {
        const x = rankCols.get(rank);
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
  );
}

function TreeLinks({
  links,
  activeNode,
}: {
  links: { source: HierarchyPointNode<RawNode>; target: HierarchyPointNode<RawNode> }[];
  activeNode: HierarchyPointNode<RawNode> | null;
}) {
  return (
    <g className="tree-links" fill="none" strokeLinecap="round">
      {links.map((l, i) => {
        const isActive =
          activeNode && l.target !== activeNode && l.target.ancestors().includes(activeNode);
        return (
          <path
            key={i}
            d={linkPath(l.source, l.target)}
            stroke={isActive ? "var(--color-ink)" : "var(--color-ink-muted)"}
            strokeOpacity={isActive ? 0.9 : 0.55}
            strokeWidth={isActive ? 1.8 : 1.1}
          />
        );
      })}
    </g>
  );
}

function InternalLabels({
  nodes,
  activeNode,
}: {
  nodes: HierarchyPointNode<RawNode>[];
  activeNode: HierarchyPointNode<RawNode> | null;
}) {
  return (
    <g className="tree-internal-labels" pointerEvents="none">
      {nodes
        .filter((n) => n.depth > 0 && !n.data.plant)
        .map((n) => {
          const isActive = n === activeNode || (activeNode && activeNode.ancestors().includes(n));
          return (
            <text
              key={`il-${n.data.rank}-${n.data.name}-${n.depth}`}
              x={n.y}
              y={n.x - 10}
              textAnchor="middle"
              fontFamily="'Space Mono', monospace"
              fontSize={11}
              fill="var(--color-ink)"
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
  );
}

function TreeNodes({
  nodes,
  activeNode,
  pinned,
  pinnedKey,
  baseURL,
  makeNodeHandlers,
}: {
  nodes: HierarchyPointNode<RawNode>[];
  activeNode: HierarchyPointNode<RawNode> | null;
  pinned: HierarchyPointNode<RawNode> | null;
  pinnedKey: number;
  baseURL: string;
  makeNodeHandlers: (n: HierarchyPointNode<RawNode>) => {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
}) {
  return (
    <g className="tree-nodes">
      {nodes.map((n) => {
        const isLeaf = !!n.data.plant;
        const isActive = n === activeNode;
        const isPinned = n === pinned;
        const isAncestorOfActive = !!(activeNode && activeNode.ancestors().includes(n));
        const handlers = makeNodeHandlers(n);

        return isLeaf ? (
          <LeafNode
            key={`leaf-${n.data.plant!.id}`}
            n={n}
            isActive={isActive}
            isPinned={isPinned}
            pinnedKey={pinnedKey}
            baseURL={baseURL}
            handlers={handlers}
          />
        ) : (
          <InternalNode
            key={`int-${n.data.rank}-${n.data.name}-${n.depth}`}
            n={n}
            isActive={isActive}
            isPinned={isPinned}
            isAncestorOfActive={isAncestorOfActive}
            pinnedKey={pinnedKey}
            handlers={handlers}
          />
        );
      })}
    </g>
  );
}

function LeafNode({
  n,
  isActive,
  isPinned,
  pinnedKey,
  baseURL,
  handlers,
}: {
  n: HierarchyPointNode<RawNode>;
  isActive: boolean;
  isPinned: boolean;
  pinnedKey: number;
  baseURL: string;
  handlers: { onPointerEnter: () => void; onPointerLeave: () => void; onClick: (e: React.MouseEvent) => void };
}) {
  const p = n.data.plant!;
  const r = LEAF_RADIUS;
  const title = plantTitle(p);
  const isAnimal = p.kind === "animal";
  const nodeColor = isAnimal ? "var(--color-amber, #f59e0b)" : "var(--color-ink)";

  return (
    <g
      transform={`translate(${n.y},${n.x})`}
      style={{ cursor: "pointer" }}
      {...handlers}
    >
      <rect x={-(r + 2)} y={-(r + 4)} width={r * 2 + 4 + LABEL_COL} height={r * 2 + 8} fill="transparent" stroke="none" />
      {isPinned && (
        <circle key={`burst-${pinnedKey}`} r={r + 14} fill="url(#leaf-glow)" className="node-select-burst" />
      )}
      {isPinned && (
        <circle r={r + 16} fill="none" stroke={nodeColor} strokeWidth={1.2} className="node-halo-persist" />
      )}
      {isActive && <circle r={r + 12} fill="url(#leaf-glow)" />}
      <circle
        r={r + 2}
        fill="var(--color-surface)"
        stroke={isActive ? nodeColor : isAnimal ? "rgba(245,158,11,0.6)" : "var(--color-ink-muted)"}
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
        {p.fullName && p.fullName !== title && (
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
            {p.fullName}
          </text>
        )}
      </g>
    </g>
  );
}

function InternalNode({
  n,
  isActive,
  isPinned,
  isAncestorOfActive,
  pinnedKey,
  handlers,
}: {
  n: HierarchyPointNode<RawNode>;
  isActive: boolean;
  isPinned: boolean;
  isAncestorOfActive: boolean;
  pinnedKey: number;
  handlers: { onPointerEnter: () => void; onPointerLeave: () => void; onClick: (e: React.MouseEvent) => void };
}) {
  const isRoot = n.depth === 0;
  const branching = (n.children?.length ?? 0) > 1;
  const r = isRoot ? 6 : branching ? NODE_RADIUS_BASE : NODE_RADIUS_BASE - 1.5;

  return (
    <g
      transform={`translate(${n.y},${n.x})`}
      style={{ cursor: "pointer" }}
      {...handlers}
    >
      <circle r={r + 14} fill="transparent" stroke="none" />
      {isPinned && (
        <circle key={`burst-${pinnedKey}`} r={r + 10} fill="url(#leaf-glow)" className="node-select-burst" />
      )}
      {isPinned && (
        <circle r={r + 9} fill="none" stroke="var(--color-ink)" strokeWidth={0.8} className="node-halo-persist" />
      )}
      <circle
        r={r}
        fill={isActive || isAncestorOfActive ? "var(--color-ink)" : "var(--color-ink-muted)"}
        fillOpacity={isActive || isAncestorOfActive ? 1 : 0.75}
      />
    </g>
  );
}

// --- Search panel ---

import type { SearchItem } from "./useTreeSearch";

function SearchPanel({
  searchQuery,
  setSearchQuery,
  searchHi,
  setSearchHi,
  matches,
  searchInputRef,
  closeSearch,
  selectSearchItem,
  onSearchKeyDown,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchHi: number;
  setSearchHi: (i: number) => void;
  matches: SearchItem[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  closeSearch: () => void;
  selectSearchItem: (item: SearchItem) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="w-72 max-w-[80vw] rounded-md bg-surface-raised/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-ink-faint/15">
        <Search size={12} strokeWidth={1.5} className="text-ink-muted shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Species, common, or taxa…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
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
              <li key={`sr-${m.node.depth}-${m.node.data.rank}-${m.node.data.name}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setSearchHi(i)}
                  onClick={() => selectSearchItem(m)}
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
