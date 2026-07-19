import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import {
  ArrowLeftRight,
  Check,
  LoaderCircle,
  Maximize2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  Organism,
  OrganismRecord,
  Relationship,
  RelationshipDirection,
  RelationshipType,
} from "../types";
import type { RelationshipsData } from "../hooks/useRelationships";
import { effectiveDirection } from "../hooks/useRelationships";
import { usePanZoom } from "../hooks/usePanZoom";
import { imageSrc } from "../data/source";
import { LEAF_RADIUS } from "./TreeView/types";
import { CtrlBtn } from "./TreeView/CtrlBtn";
import {
  addRelationship,
  deleteRelationship,
  deleteRelationshipType,
  slugifyTypeId,
  updateRelationship,
  upsertRelationshipType,
} from "../data/relationshipMutations";
import RelationshipAIAssist from "./RelationshipAIAssist";
import { useAIFeaturesVisible } from "../hooks/useAIFeatures";
import { Dropdown, type DropdownOption } from "./Dropdown";

// Same palette as the food web, so a type keeps its colour across both views.
const TYPE_COLORS = [
  "var(--color-accent)",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#f87171",
];

const NODE_R = LEAF_RADIUS;
// Fresh gardens (no relationships yet) auto-seed the canvas with every organism
// up to this many, so a first-time user can immediately drag between plants.
const AUTO_SEED_CAP = 60;

const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";
const LABEL = "block text-[10px] uppercase tracking-widest text-ink-muted font-display mb-1";

interface Props {
  organisms: Organism[];
  organismRecords: OrganismRecord[];
  relationships: RelationshipsData;
  onClose: () => void;
}

interface Pt {
  x: number;
  y: number;
}
interface SimNode extends SimulationNodeDatum {
  id: string;
}

/**
 * One-shot force layout over the canvas node set. Seeds from a persistent
 * position cache (keyed by code) so adding/removing a node relaxes the existing
 * arrangement instead of reshuffling it — mirroring the food web's behaviour.
 */
function runLayout(
  codes: string[],
  edges: Array<[string, string]>,
  cache: Map<string, Pt>,
): Map<string, Pt> {
  const positions = new Map<string, Pt>();
  if (codes.length === 0) return positions;
  if (codes.length === 1) {
    const p = cache.get(codes[0]) ?? { x: 800, y: 500 };
    positions.set(codes[0], p);
    cache.set(codes[0], p);
    return positions;
  }

  let cached = 0;
  const nodes: SimNode[] = codes.map((id, i) => {
    const c = cache.get(id);
    if (c) {
      cached++;
      return { id, x: c.x, y: c.y };
    }
    const a = (i / codes.length) * Math.PI * 2;
    return { id, x: 800 + Math.cos(a) * 260, y: 500 + Math.sin(a) * 260 };
  });
  const has = new Set(codes);
  const links = edges
    .filter(([a, b]) => has.has(a) && has.has(b))
    .map(([source, target]) => ({ source, target }));

  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((d) => d.id)
        .distance(240)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-2600).distanceMax(1200))
    .force("collide", forceCollide(NODE_R * 3 + 40).strength(1))
    .force("x", forceX(800).strength(0.05))
    .force("y", forceY(500).strength(0.05))
    .stop();

  const mostlyCached = cached >= codes.length * 0.5;
  const ticks = mostlyCached ? 120 : 300;
  sim.alpha(mostlyCached ? 0.3 : 1).alphaDecay(mostlyCached ? 0.05 : 0.0228);
  for (let i = 0; i < ticks; i++) sim.tick();

  for (const n of nodes) {
    const p = { x: n.x ?? 0, y: n.y ?? 0 };
    positions.set(n.id, p);
    cache.set(n.id, p);
  }
  return positions;
}

type DirChoice = "auto" | RelationshipDirection;

function dirToStored(d: DirChoice): RelationshipDirection | undefined {
  return d === "auto" ? undefined : d;
}

/** Segmented control for the four direction choices. */
function DirectionPicker({
  value,
  directional,
  onChange,
  disabled,
}: {
  value: DirChoice;
  directional: boolean;
  onChange: (d: DirChoice) => void;
  disabled?: boolean;
}) {
  const opts: { key: DirChoice; label: string; title: string }[] = [
    { key: "auto", label: directional ? "→ auto" : "↔ auto", title: "Use the type's default" },
    { key: "f", label: "→", title: "From → To" },
    { key: "b", label: "←", title: "To → From" },
    { key: "u", label: "↔", title: "Undirected" },
  ];
  return (
    <div className="flex rounded border border-white/10 overflow-hidden">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          title={o.title}
          onClick={() => onChange(o.key)}
          className={`flex-1 px-2 py-1.5 text-xs font-mono transition-colors ${
            value === o.key
              ? "bg-accent/20 text-accent"
              : "text-ink-muted hover:text-ink hover:bg-white/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Create / edit form for a relationship type. */
function TypeForm({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial?: RelationshipType;
  onSubmit: (t: { id: string; name: string; description: string; directional: boolean }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [directional, setDirectional] = useState(initial?.directional ?? true);
  const [description, setDescription] = useState(initial?.description ?? "");
  const id = editing ? initial!.id : slugifyTypeId(name);

  return (
    <div className="space-y-2.5 rounded border border-white/10 bg-white/3 p-3">
      <div>
        <label className={LABEL}>Type name</label>
        <input
          className={INPUT}
          autoFocus
          value={name}
          disabled={busy}
          placeholder="e.g. Pollinates, Companion"
          onChange={(e) => setName(e.target.value)}
        />
        {name.trim() && (
          <p className="mt-1 text-[10px] font-mono text-ink-faint">id: {id}</p>
        )}
      </div>
      <div>
        <label className={LABEL}>Description (optional)</label>
        <input
          className={INPUT}
          value={description}
          disabled={busy}
          placeholder="Shown in the legend tooltip"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none">
        <input
          type="checkbox"
          checked={directional}
          disabled={busy}
          onChange={(e) => setDirectional(e.target.checked)}
          className="accent-accent"
        />
        Directional (draws an arrow from → to)
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => onSubmit({ id, name, description, directional })}
          className="px-3 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
        >
          {editing ? "Save type" : "Add type"}
        </button>
      </div>
    </div>
  );
}

export default function RelationshipEditor({
  organisms,
  organismRecords,
  relationships,
  onClose,
}: Props) {
  const { types, typeById, relationships: rels } = relationships;

  const colorByType = useMemo(() => {
    const m = new Map<string, string>();
    types.forEach((t, i) => m.set(t.id, TYPE_COLORS[i % TYPE_COLORS.length]));
    return m;
  }, [types]);

  const labelByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of organismRecords) m.set(r.shortCode, r.commonName ?? r.fullName ?? r.shortCode);
    for (const o of organisms) if (!m.has(o.shortCode)) m.set(o.shortCode, o.commonName ?? o.fullName ?? o.shortCode);
    return m;
  }, [organismRecords, organisms]);

  const label = useCallback((code: string) => labelByCode.get(code) ?? code, [labelByCode]);

  // Latest pic per code (for the node thumbnail).
  const organismByCode = useMemo(() => {
    const m = new Map<string, Organism>();
    for (const o of organisms) {
      const prev = m.get(o.shortCode);
      if (!prev || new Date(o.addedAt) > new Date(prev.addedAt)) m.set(o.shortCode, o);
    }
    return m;
  }, [organisms]);

  const connectedCodes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rels) {
      s.add(r.from);
      s.add(r.to);
    }
    return s;
  }, [rels]);

  const allCodes = useMemo(
    () => Array.from(new Set(organismRecords.map((r) => r.shortCode))).sort(),
    [organismRecords],
  );

  // Extra organisms the user has pulled onto the canvas beyond the connected
  // set. On a fresh garden with no relationships, seed with everything (capped)
  // so there is something to link right away.
  const [extraCodes, setExtraCodes] = useState<Set<string>>(() =>
    rels.length === 0 ? new Set(allCodes.slice(0, AUTO_SEED_CAP)) : new Set<string>(),
  );

  const nodeCodes = useMemo(() => {
    const s = new Set<string>(extraCodes);
    for (const c of connectedCodes) s.add(c);
    return Array.from(s).sort();
  }, [extraCodes, connectedCodes]);

  const posCache = useRef<Map<string, Pt>>(new Map());
  const positions = useMemo(
    () => runLayout(nodeCodes, rels.map((r) => [r.from, r.to] as [string, string]), posCache.current),
    [nodeCodes, rels],
  );

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
    layoutWidth: 1600,
    layoutHeight: 1000,
    dataReady: true,
    minK: 0.1,
    maxK: 4,
    initialZoom: 0.7,
  });

  // Latest transform + positions for the window-level drag hit-testing.
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600);
  }, []);

  // Drag-to-connect ---------------------------------------------------------
  const dragRef = useRef<{ from: string; moved: boolean } | null>(null);
  const [live, setLive] = useState<{ from: string; x: number; y: number; over: string | null } | null>(
    null,
  );
  // Pending relationship awaiting the composer.
  const [compose, setCompose] = useState<{ from: string; to: string } | null>(null);

  const clientToCanvas = useCallback((clientX: number, clientY: number): Pt => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const t = transformRef.current;
    const cx = clientX - (rect?.left ?? 0);
    const cy = clientY - (rect?.top ?? 0);
    return { x: (cx - t.x) / t.k, y: (cy - t.y) / t.k };
  }, [containerRef]);

  const nodeAt = useCallback((p: Pt): string | null => {
    let best: string | null = null;
    let bestD = NODE_R + 10;
    for (const [code, pos] of positionsRef.current) {
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = code;
      }
    }
    return best;
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = clientToCanvas(e.clientX, e.clientY);
      d.moved = true;
      const over = nodeAt(p);
      setLive({ from: d.from, x: p.x, y: p.y, over: over && over !== d.from ? over : null });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const p = clientToCanvas(e.clientX, e.clientY);
      const over = nodeAt(p);
      setLive(null);
      if (d.moved && over && over !== d.from) {
        setCompose({ from: d.from, to: over });
      } else if (!d.moved) {
        setSelected(d.from);
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
  }, [clientToCanvas, nodeAt]);

  const onNodePointerDown = useCallback((e: React.PointerEvent, code: string) => {
    e.stopPropagation();
    dragRef.current = { from: code, moved: false };
    setLive({ from: code, x: positionsRef.current.get(code)?.x ?? 0, y: positionsRef.current.get(code)?.y ?? 0, over: null });
  }, []);

  // Edge selection / editing ------------------------------------------------
  const [editEdge, setEditEdge] = useState<Relationship | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>, okMsg?: string) => {
      setBusy(true);
      try {
        await fn();
        if (okMsg) showToast(okMsg);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  // Type management ---------------------------------------------------------
  const [typesOpen, setTypesOpen] = useState(false);
  const [typeForm, setTypeForm] = useState<null | { editing?: RelationshipType }>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const aiVisible = useAIFeaturesVisible();

  const knownCodes = useMemo(() => new Set(labelByCode.keys()), [labelByCode]);

  const selectedRels = useMemo(
    () => (selected ? rels.filter((r) => r.from === selected || r.to === selected) : []),
    [rels, selected],
  );

  const edgesForRender = useMemo(() => {
    // Bundle parallel edges (same unordered pair) so they fan out.
    const groups = new Map<string, Relationship[]>();
    for (const r of rels) {
      if (!positions.has(r.from) || !positions.has(r.to)) continue;
      const key = [r.from, r.to].sort().join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const out: {
      rel: Relationship;
      color: string;
      dir: "fwd" | "bwd" | "u";
      typeName: string;
      idx: number;
      total: number;
    }[] = [];
    for (const g of groups.values()) {
      g.forEach((rel, idx) =>
        out.push({
          rel,
          color: colorByType.get(rel.type) ?? "var(--color-ink-muted)",
          dir: effectiveDirection(rel, typeById.get(rel.type)),
          typeName: typeById.get(rel.type)?.name ?? rel.type,
          idx,
          total: g.length,
        }),
      );
    }
    return out;
  }, [rels, positions, colorByType, typeById]);

  const highlight = useMemo(() => {
    if (!selected) return { nodes: new Set<string>(), edges: new Set<number>() };
    const n = new Set<string>([selected]);
    const e = new Set<number>();
    for (const r of rels) {
      if (r.from === selected) {
        n.add(r.to);
        e.add(r.id);
      } else if (r.to === selected) {
        n.add(r.from);
        e.add(r.id);
      }
    }
    return { nodes: n, edges: e };
  }, [rels, selected]);

  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  const arrow = (dir: "fwd" | "bwd" | "u") => (dir === "u" ? "↔" : dir === "bwd" ? "←" : "→");

  // Portal to <body> so the full-screen overlay escapes the food web's
  // `z-10` stacking context — otherwise the app header (`sticky z-40`) paints
  // over the studio's top bar and controls.
  return createPortal(
    <div className="fixed inset-0 z-80 flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10 bg-surface">
        <div className="min-w-0">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink truncate">
            Relationship studio
          </h2>
          <p className="hidden sm:block text-[11px] text-ink-faint">
            Drag from one organism to another to connect them · click a link to edit it
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {busy && <LoaderCircle size={15} className="animate-spin text-ink-muted" />}
          {aiVisible && (
            <button
              onClick={() => setAiOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-accent hover:bg-accent/10 transition-colors"
              title="Generate a prompt for a model, then paste its reply back to create relationships"
            >
              <Sparkles size={14} /> <span className="hidden sm:inline">AI assist</span>
            </button>
          )}
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
          >
            <Plus size={14} /> <span className="hidden sm:inline">Add organism</span>
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-8 w-8 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden bg-surface-raised/30"
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
          setSelected(null);
        }}
      >
        {nodeCodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-ink-muted text-sm font-display tracking-wide">NO ORGANISMS YET</p>
            <p className="text-[11px] text-ink-faint max-w-xs">
              Add photos to your garden first, then come back to connect them.
            </p>
          </div>
        ) : (
          <svg
            width={1600}
            height={1000}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
              transformOrigin: "0 0",
              display: "block",
              opacity: ready ? 1 : 0,
              transition: "opacity 200ms ease-out",
              overflow: "visible",
            }}
          >
            <defs>
              <clipPath id="re-clip">
                <circle r={NODE_R} />
              </clipPath>
              <radialGradient id="re-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.45" />
                <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
              </radialGradient>
              {Array.from(colorByType.entries()).map(([id, color]) => (
                <marker
                  key={id}
                  id={`re-arr-${id}`}
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

            {/* Live connection line */}
            {live && positions.get(live.from) && (
              <line
                x1={positions.get(live.from)!.x}
                y1={positions.get(live.from)!.y}
                x2={live.over ? positions.get(live.over)!.x : live.x}
                y2={live.over ? positions.get(live.over)!.y : live.y}
                stroke="var(--color-accent)"
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeLinecap="round"
                opacity={0.9}
                pointerEvents="none"
              />
            )}

            {/* Edges */}
            <g>
              {edgesForRender.map(({ rel, color, dir, typeName, idx, total }) => {
                const a = positions.get(rel.from)!;
                const b = positions.get(rel.to)!;
                const reverse = dir === "bwd";
                const x1 = reverse ? b.x : a.x;
                const y1 = reverse ? b.y : a.y;
                const x2 = reverse ? a.x : b.x;
                const y2 = reverse ? a.y : b.y;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const len = Math.max(0.01, Math.hypot(dx, dy));
                const nx = -dy / len;
                const ny = dx / len;
                const offset = (idx - (total - 1) / 2) * 60;
                const cx = mx + nx * offset * 2;
                const cy = my + ny * offset * 2;
                const active = highlight.edges.has(rel.id);
                const dim = selected != null && !active;
                let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
                if (ang > 90) ang -= 180;
                else if (ang < -90) ang += 180;
                return (
                  <g
                    key={`e-${rel.id}`}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditEdge(rel);
                    }}
                  >
                    <path
                      d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeOpacity={dim ? 0.12 : active ? 0.95 : 0.5}
                      strokeWidth={active ? 2.2 : 8}
                      strokeLinecap="round"
                      opacity={0}
                    />
                    <path
                      d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeOpacity={dim ? 0.12 : active ? 0.95 : 0.5}
                      strokeWidth={active ? 2 : 1.3}
                      markerEnd={dir !== "u" ? `url(#re-arr-${rel.type})` : undefined}
                      pointerEvents="none"
                    />
                    <g
                      transform={`translate(${mx + nx * offset},${my + ny * offset}) rotate(${ang})`}
                      pointerEvents="none"
                    >
                      <text
                        textAnchor="middle"
                        dy={-5}
                        fontFamily="'Space Mono', monospace"
                        fontSize={9}
                        letterSpacing="0.06em"
                        fill={active ? "var(--color-ink)" : "var(--color-ink-muted)"}
                        fillOpacity={dim ? 0.2 : 0.9}
                        stroke="var(--color-surface)"
                        strokeWidth={4}
                        strokeOpacity={0.9}
                        paintOrder="stroke fill"
                      >
                        {typeName}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>

            {/* Nodes */}
            <g>
              {nodeCodes.map((code) => {
                const p = positions.get(code)!;
                const org = organismByCode.get(code);
                const isSel = code === selected;
                const isNbr = highlight.nodes.has(code) && !isSel;
                const dim = selected != null && !isSel && !isNbr;
                const isOver = live?.over === code;
                const isAnimal = org?.kind === "animal";
                const stroke = isSel
                  ? isAnimal
                    ? "var(--color-amber, #f59e0b)"
                    : "var(--color-ink)"
                  : isAnimal
                    ? "rgba(245,158,11,0.6)"
                    : "var(--color-ink-muted)";
                return (
                  <g
                    key={`n-${code}`}
                    data-node="true"
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: "grab", opacity: dim ? 0.35 : 1, transition: "opacity 160ms" }}
                    onPointerDown={(e) => onNodePointerDown(e, code)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <circle r={NODE_R + 16} fill="transparent" />
                    {(isSel || isOver) && <circle r={NODE_R + 12} fill="url(#re-glow)" />}
                    {isOver && (
                      <circle r={NODE_R + 8} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
                    )}
                    <circle
                      r={NODE_R + 2}
                      fill="var(--color-surface)"
                      stroke={stroke}
                      strokeOpacity={isSel ? 0.95 : 0.7}
                      strokeWidth={isSel ? 2 : 1.2}
                    />
                    {org ? (
                      <g clipPath="url(#re-clip)">
                        <image
                          href={imageSrc(org.image, 200)}
                          x={-NODE_R}
                          y={-NODE_R}
                          width={NODE_R * 2}
                          height={NODE_R * 2}
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
                        {code}
                      </text>
                    )}
                    <text
                      y={NODE_R + 15}
                      textAnchor="middle"
                      pointerEvents="none"
                      fontFamily="'DM Sans', sans-serif"
                      fontSize={12}
                      fontWeight={500}
                      fill="var(--color-ink)"
                      stroke="var(--color-surface)"
                      strokeWidth={3}
                      strokeOpacity={0.85}
                      paintOrder="stroke fill"
                    >
                      {label(code)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Zoom controls */}
        <div
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-surface/85 backdrop-blur-sm ring-1 ring-inset ring-white/5 p-1"
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

        {/* Types manager */}
        <div
          className="absolute top-3 left-3 w-64 max-w-[calc(100%-1.5rem)]"
          onClick={stop}
          onPointerDown={stop}
          onWheel={stop}
        >
          <div className="rounded-md bg-surface/90 backdrop-blur-sm border border-white/10 overflow-hidden">
            <button
              onClick={() => setTypesOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-mono uppercase tracking-[0.15em] text-ink-muted hover:text-ink transition-colors"
            >
              <span>Relationship types ({types.length})</span>
              <span className="text-ink-faint">{typesOpen ? "–" : "+"}</span>
            </button>
            {typesOpen && (
              <div className="px-2 pb-2 space-y-1 max-h-[40vh] overflow-y-auto thin-scroll">
                {types.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5"
                  >
                    <span
                      className="inline-block w-2.5 h-0.5 shrink-0"
                      style={{ background: colorByType.get(t.id) }}
                    />
                    <span className="text-xs text-ink truncate flex-1" title={t.description}>
                      {t.name}
                      {t.directional && <span className="text-ink-faint"> →</span>}
                    </span>
                    <button
                      onClick={() => setTypeForm({ editing: t })}
                      className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-ink transition"
                      title="Edit type"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          try {
                            await deleteRelationshipType(t.id);
                            showToast(`Deleted type "${t.name}"`);
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "";
                            if (
                              /still use/.test(msg) &&
                              window.confirm(`${msg}\n\nDelete the type AND those relationships?`)
                            ) {
                              await deleteRelationshipType(t.id, true);
                              showToast(`Deleted type "${t.name}" and its links`);
                            } else if (!/still use/.test(msg)) {
                              throw err;
                            }
                          }
                        })
                      }
                      className="opacity-0 group-hover:opacity-100 text-rose-300/70 hover:text-rose-300 transition"
                      title="Delete type"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {types.length === 0 && (
                  <p className="px-1.5 py-1 text-[11px] text-ink-faint italic">
                    No types yet — add one to start connecting.
                  </p>
                )}
                {typeForm ? (
                  <TypeForm
                    initial={typeForm.editing}
                    busy={busy}
                    onCancel={() => setTypeForm(null)}
                    onSubmit={(t) =>
                      run(async () => {
                        await upsertRelationshipType(t);
                        setTypeForm(null);
                      }, typeForm.editing ? "Type saved" : "Type added")
                    }
                  />
                ) : (
                  <button
                    onClick={() => setTypeForm({})}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1.5 rounded text-xs text-accent hover:bg-white/5 transition-colors"
                  >
                    <Plus size={13} /> New type
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Selected-node detail */}
        {selected && (
          <div
            className="absolute bottom-3 left-3 w-72 max-w-[calc(100%-1.5rem)] rounded-md bg-surface/92 backdrop-blur-sm border border-white/10 overflow-hidden"
            onClick={stop}
            onPointerDown={stop}
            onWheel={stop}
          >
            <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/10">
              {organismByCode.get(selected) && (
                <img
                  src={imageSrc(organismByCode.get(selected)!.image, 100)}
                  alt=""
                  className="w-8 h-8 rounded object-cover ring-1 ring-white/10"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">{label(selected)}</p>
                <p className="text-[10px] font-mono text-ink-faint truncate">{selected}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-ink-muted hover:text-ink"
                aria-label="Deselect"
              >
                <X size={15} />
              </button>
            </div>
            <div className="max-h-56 overflow-y-auto thin-scroll py-1">
              {selectedRels.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink-faint italic">
                  No links yet. Drag from this organism to another to connect them.
                </p>
              ) : (
                selectedRels.map((r) => {
                  const dir = effectiveDirection(r, typeById.get(r.type));
                  const other = r.from === selected ? r.to : r.from;
                  return (
                    <div
                      key={r.id}
                      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-white/5"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ background: colorByType.get(r.type) }}
                      />
                      <span className="text-[11px] text-ink-muted font-mono shrink-0">
                        {arrow(r.from === selected ? dir : dir === "fwd" ? "bwd" : dir === "bwd" ? "fwd" : "u")}
                      </span>
                      <button
                        onClick={() => setSelected(other)}
                        className="text-xs text-ink truncate flex-1 text-left hover:text-accent"
                      >
                        {label(other)}
                      </button>
                      <span className="text-[9px] font-mono uppercase tracking-wide text-ink-faint shrink-0">
                        {typeById.get(r.type)?.name ?? r.type}
                      </span>
                      <button
                        onClick={() => setEditEdge(r)}
                        className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-ink transition shrink-0"
                        title="Edit link"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Add-organism search */}
        {addOpen && (
          <div
            className="absolute top-3 right-3 w-72 max-w-[calc(100%-1.5rem)]"
            onClick={stop}
            onPointerDown={stop}
            onWheel={stop}
          >
            <AddOrganismPanel
              allCodes={allCodes}
              onCanvas={new Set(nodeCodes)}
              label={label}
              organismByCode={organismByCode}
              onAdd={(code) => {
                setExtraCodes((s) => new Set(s).add(code));
                const pos = posCache.current.get(code);
                if (pos) centerOn(pos.x, pos.y);
                setSelected(code);
              }}
              onClose={() => setAddOpen(false)}
            />
          </div>
        )}

        {toast && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-md bg-surface/95 border border-white/10 text-xs text-ink shadow-lg">
            {toast}
          </div>
        )}
      </div>

      {/* AI assist */}
      {aiOpen && aiVisible && (
        <RelationshipAIAssist
          knownCodes={knownCodes}
          onClose={() => setAiOpen(false)}
          onApplied={() => setSelected(null)}
        />
      )}

      {/* Composer */}
      {compose && (
        <Composer
          from={compose.from}
          to={compose.to}
          label={label}
          types={types}
          busy={busy}
          onSwap={() => setCompose((c) => (c ? { from: c.to, to: c.from } : c))}
          onCancel={() => setCompose(null)}
          onSubmit={(input) =>
            run(async () => {
              let typeId = input.typeId;
              if (input.newType) {
                const t = await upsertRelationshipType(input.newType);
                typeId = t.id;
              }
              await addRelationship({
                typeId,
                from: compose.from,
                to: compose.to,
                direction: input.direction,
              });
              setCompose(null);
              setSelected(compose.from);
            }, "Relationship added")
          }
        />
      )}

      {/* Edge editor */}
      {editEdge && (
        <EdgeEditor
          rel={editEdge}
          label={label}
          types={types}
          typeById={typeById}
          busy={busy}
          onCancel={() => setEditEdge(null)}
          onDelete={() =>
            run(async () => {
              await deleteRelationship(editEdge.id);
              setEditEdge(null);
            }, "Relationship deleted")
          }
          onSave={(fields) =>
            run(async () => {
              await updateRelationship(editEdge.id, fields);
              setEditEdge(null);
            }, "Relationship updated")
          }
        />
      )}
    </div>,
    document.body,
  );
}

// ─── Add-organism search panel ──────────────────────────────────────────────

function AddOrganismPanel({
  allCodes,
  onCanvas,
  label,
  organismByCode,
  onAdd,
  onClose,
}: {
  allCodes: string[];
  onCanvas: Set<string>;
  label: (c: string) => string;
  organismByCode: Map<string, Organism>;
  onAdd: (code: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allCodes
      .filter((c) => !onCanvas.has(c))
      .filter((c) => !query || label(c).toLowerCase().includes(query) || c.toLowerCase().includes(query))
      .slice(0, 40);
  }, [allCodes, onCanvas, label, q]);

  return (
    <div className="rounded-md bg-surface-raised/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10">
        <Search size={12} className="text-ink-muted shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add organism to canvas…"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
          spellCheck={false}
        />
        <button onClick={onClose} className="text-ink-muted hover:text-ink shrink-0" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      <ul className="max-h-72 overflow-y-auto thin-scroll py-1">
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-[11px] text-ink-faint italic">
            {onCanvas.size >= allCodes.length ? "Everything's already on the canvas" : "No matches"}
          </li>
        ) : (
          matches.map((c) => (
            <li key={c}>
              <button
                onClick={() => onAdd(c)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
              >
                {organismByCode.get(c) ? (
                  <img
                    src={imageSrc(organismByCode.get(c)!.image, 80)}
                    alt=""
                    className="w-6 h-6 rounded object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <span className="w-6 h-6 rounded bg-white/5 shrink-0" />
                )}
                <span className="text-xs text-ink truncate min-w-0">{label(c)}</span>
                <span className="ml-auto text-[9px] font-mono text-ink-faint shrink-0">{c}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ─── Composer (new relationship) ────────────────────────────────────────────

interface ComposerSubmit {
  typeId: string;
  direction?: RelationshipDirection;
  newType?: { id: string; name: string; description: string; directional: boolean };
}

function Composer({
  from,
  to,
  label,
  types,
  busy,
  onSwap,
  onCancel,
  onSubmit,
}: {
  from: string;
  to: string;
  label: (c: string) => string;
  types: RelationshipType[];
  busy: boolean;
  onSwap: () => void;
  onCancel: () => void;
  onSubmit: (s: ComposerSubmit) => void;
}) {
  const NEW = "__new__";
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? NEW);
  const [dir, setDir] = useState<DirChoice>("auto");
  const [newName, setNewName] = useState("");
  const [newDirectional, setNewDirectional] = useState(true);

  const creatingType = typeId === NEW || types.length === 0;
  const activeType = types.find((t) => t.id === typeId);
  const directional = creatingType ? newDirectional : activeType?.directional ?? true;

  const typeOptions = useMemo<DropdownOption[]>(
    () => [
      ...types.map((t) => ({ value: t.id, label: t.name, hint: t.directional ? "→" : "↔" })),
      { value: NEW, label: "＋ New type…" },
    ],
    [types],
  );

  const submit = () => {
    if (creatingType) {
      const id = slugifyTypeId(newName);
      onSubmit({
        typeId: id,
        direction: dirToStored(dir),
        newType: { id, name: newName, description: "", directional: newDirectional },
      });
    } else {
      onSubmit({ typeId, direction: dirToStored(dir) });
    }
  };

  return (
    <Modal onClose={onCancel} busy={busy} title="New relationship">
      <div className="flex items-center gap-2 rounded bg-white/3 border border-white/10 p-2.5">
        <span className="text-sm text-ink truncate flex-1 text-right">{label(from)}</span>
        <button
          onClick={onSwap}
          disabled={busy}
          title="Swap direction of endpoints"
          className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-white/5 transition-colors shrink-0"
        >
          <ArrowLeftRight size={14} />
        </button>
        <span className="text-sm text-ink truncate flex-1">{label(to)}</span>
      </div>

      <div>
        <label className={LABEL}>Type</label>
        {types.length > 0 && (
          <Dropdown value={typeId} options={typeOptions} onChange={setTypeId} disabled={busy} />
        )}
      </div>

      {creatingType && (
        <div className="space-y-2 rounded border border-white/10 bg-white/3 p-2.5">
          <input
            className={INPUT}
            autoFocus
            value={newName}
            disabled={busy}
            placeholder="New type name (e.g. Pollinates)"
            onChange={(e) => setNewName(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newDirectional}
              disabled={busy}
              onChange={(e) => setNewDirectional(e.target.checked)}
              className="accent-accent"
            />
            Directional
          </label>
        </div>
      )}

      <div>
        <label className={LABEL}>Direction</label>
        <DirectionPicker value={dir} directional={directional} onChange={setDir} disabled={busy} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || (creatingType && !newName.trim())}
          className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          <Check size={13} /> Create link
        </button>
      </div>
    </Modal>
  );
}

// ─── Edge editor (existing relationship) ────────────────────────────────────

function EdgeEditor({
  rel,
  label,
  types,
  typeById,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  rel: Relationship;
  label: (c: string) => string;
  types: RelationshipType[];
  typeById: Map<string, RelationshipType>;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: (fields: { typeId?: string; direction?: RelationshipDirection }) => void;
}) {
  const [typeId, setTypeId] = useState(rel.type);
  const initialDir: DirChoice = rel.direction ?? "auto";
  const [dir, setDir] = useState<DirChoice>(initialDir);
  const [confirmDel, setConfirmDel] = useState(false);
  const directional = (typeById.get(typeId) ?? types.find((t) => t.id === typeId))?.directional ?? true;

  const typeOptions = useMemo<DropdownOption[]>(
    () => types.map((t) => ({ value: t.id, label: t.name, hint: t.directional ? "→" : "↔" })),
    [types],
  );

  return (
    <Modal onClose={onCancel} busy={busy} title="Edit relationship">
      <div className="flex items-center gap-2 rounded bg-white/3 border border-white/10 p-2.5 text-sm text-ink">
        <span className="truncate flex-1 text-right">{label(rel.from)}</span>
        <span className="text-ink-muted font-mono shrink-0">
          {effectiveDirection(rel, typeById.get(rel.type)) === "u" ? "↔" : "→"}
        </span>
        <span className="truncate flex-1">{label(rel.to)}</span>
      </div>

      <div>
        <label className={LABEL}>Type</label>
        <Dropdown value={typeId} options={typeOptions} onChange={setTypeId} disabled={busy} />
      </div>

      <div>
        <label className={LABEL}>Direction</label>
        <DirectionPicker value={dir} directional={directional} onChange={setDir} disabled={busy} />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}
          disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider transition-colors ${
            confirmDel
              ? "bg-rose-900/60 text-rose-200 hover:bg-rose-900/80"
              : "text-rose-300/80 hover:text-rose-300"
          }`}
        >
          <Trash2 size={13} /> {confirmDel ? "Really delete?" : "Delete"}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                typeId: typeId !== rel.type ? typeId : undefined,
                direction: dirToStored(dir),
              })
            }
            disabled={busy}
            className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Shared modal shell ─────────────────────────────────────────────────────

function Modal({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-black/70"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
