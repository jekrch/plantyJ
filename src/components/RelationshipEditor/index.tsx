import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link2,
  LoaderCircle,
  Maximize2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Organism, OrganismRecord, Relationship, RelationshipType } from "../../types";
import type { RelationshipsData } from "../../hooks/useRelationships";
import { effectiveDirection } from "../../hooks/useRelationships";
import { usePanZoom } from "../../hooks/usePanZoom";
import { imageSrc } from "../../data/source";
import { CtrlBtn } from "../TreeView/CtrlBtn";
import {
  addRelationship,
  addRelationships,
  deleteRelationship,
  deleteRelationshipType,
  updateRelationship,
  upsertRelationshipType,
} from "../../data/relationshipMutations";
import RelationshipAIAssist from "../RelationshipAIAssist";
import { useAIFeaturesVisible } from "../../hooks/useAIFeatures";
import BulkConnectSheet from "../BulkConnectSheet";
import AddOrganismPanel from "./AddOrganismPanel";
import Composer from "./Composer";
import EdgeEditor from "./EdgeEditor";
import TypeForm from "./TypeForm";
import { useDragConnect } from "./useDragConnect";
import {
  CANVAS_H,
  CANVAS_W,
  NODE_R,
  TYPE_COLORS,
  edgeGeometry,
  runLayout,
  type Pt,
} from "./layout";

// Fresh gardens (no relationships yet) auto-seed the canvas with every organism
// up to this many, so a first-time user can immediately drag between plants.
const AUTO_SEED_CAP = 60;

interface Props {
  organisms: Organism[];
  organismRecords: OrganismRecord[];
  relationships: RelationshipsData;
  onClose: () => void;
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
    layoutWidth: CANVAS_W,
    layoutHeight: CANVAS_H,
    dataReady: true,
    minK: 0.1,
    maxK: 4,
    initialZoom: 0.7,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600);
  }, []);

  // Pending relationship awaiting the composer.
  const [compose, setCompose] = useState<{ from: string; to: string } | null>(null);
  const startCompose = useCallback((from: string, to: string) => setCompose({ from, to }), []);
  const selectNode = useCallback((code: string) => setSelected(code), []);

  const { live, onNodePointerDown } = useDragConnect({
    containerRef,
    transform,
    positions,
    onConnect: startCompose,
    onSelect: selectNode,
  });

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
  const [bulkOpen, setBulkOpen] = useState(false);
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
            Drag between organisms to connect them, or use Connect to pick from a list · click a
            link to edit it
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {busy && <LoaderCircle size={15} className="animate-spin text-ink-muted" />}
          {aiVisible && (
            <button
              onClick={() => setAiOpen(true)}
              data-tour="rel-ai"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-accent hover:bg-accent/10 transition-colors"
              title="Generate a prompt for a model, then paste its reply back to create relationships"
            >
              <Sparkles size={14} /> <span className="hidden sm:inline">AI assist</span>
            </button>
          )}
          <button
            onClick={() => setBulkOpen(true)}
            data-tour="rel-connect"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="Pick a relationship, then tick every organism to connect — no dragging"
          >
            <Link2 size={14} /> <span className="hidden sm:inline">Connect</span>
          </button>
          <button
            onClick={() => setAddOpen((v) => !v)}
            data-tour="rel-add"
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
        data-tour="rel-canvas"
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
            width={CANVAS_W}
            height={CANVAS_H}
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
              {edgesForRender.map(({ rel, color, dir, typeName, idx, total }, i) => {
                const geo = edgeGeometry(
                  positions.get(rel.from)!,
                  positions.get(rel.to)!,
                  idx,
                  total,
                  dir === "bwd",
                );
                const active = highlight.edges.has(rel.id);
                const dim = selected != null && !active;
                return (
                  <g
                    // Index-suffixed because ids are not guaranteed unique in the
                    // file — a bare id key silently drops colliding edges.
                    key={`e-${rel.id}-${i}`}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditEdge(rel);
                    }}
                  >
                    {/* Invisible fat stroke widens the click target. */}
                    <path
                      d={geo.path}
                      fill="none"
                      stroke={color}
                      strokeOpacity={dim ? 0.12 : active ? 0.95 : 0.5}
                      strokeWidth={active ? 2.2 : 8}
                      strokeLinecap="round"
                      opacity={0}
                    />
                    <path
                      d={geo.path}
                      fill="none"
                      stroke={color}
                      strokeOpacity={dim ? 0.12 : active ? 0.95 : 0.5}
                      strokeWidth={active ? 2 : 1.3}
                      markerEnd={dir !== "u" ? `url(#re-arr-${rel.type})` : undefined}
                      pointerEvents="none"
                    />
                    <g
                      transform={`translate(${geo.labelX},${geo.labelY}) rotate(${geo.angle})`}
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
              data-tour="rel-types"
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
                selectedRels.map((r, i) => {
                  const dir = effectiveDirection(r, typeById.get(r.type));
                  const other = r.from === selected ? r.to : r.from;
                  return (
                    <div
                      key={`${r.id}-${i}`}
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

      {/* Bulk connect (list-driven alternative to dragging) */}
      {bulkOpen && (
        <BulkConnectSheet
          allCodes={allCodes}
          label={label}
          organismByCode={organismByCode}
          types={types}
          relationships={rels}
          initialSource={selected}
          busy={busy}
          onCancel={() => setBulkOpen(false)}
          onSubmit={(input) =>
            run(async () => {
              let typeId = input.typeId;
              if (input.newType) {
                const t = await upsertRelationshipType(input.newType);
                typeId = t.id;
              }
              const { created, skipped } = await addRelationships(
                input.targets.map((to) => ({
                  typeId,
                  from: input.source,
                  to,
                  direction: input.direction,
                })),
              );
              // Endpoints may not have been on the canvas — pull them in so the
              // new links are visible the moment the sheet closes.
              setExtraCodes((s) => {
                const next = new Set(s).add(input.source);
                for (const r of created) next.add(r.to);
                return next;
              });
              setBulkOpen(false);
              setSelected(input.source);
              if (created.length === 0) throw new Error(skipped[0]?.reason ?? "Nothing to add");
              showToast(
                skipped.length > 0
                  ? `Added ${created.length} · skipped ${skipped.length}`
                  : `Added ${created.length} relationship${created.length === 1 ? "" : "s"}`,
              );
            })
          }
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
