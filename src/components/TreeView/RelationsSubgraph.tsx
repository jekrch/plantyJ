import { useMemo } from "react";
import type { Plant, Relationship, RelationshipType } from "../../types";
import { effectiveDirection } from "../../hooks/useRelationships";

interface Props {
  centerCode: string;
  centerLabel: string;
  plants: Plant[];
  relationships: Relationship[];
  neighbors: Map<string, Relationship[]>;
  typeById: Map<string, RelationshipType>;
  plantsByCode: Map<string, Plant>;
  onSelectCode?: (shortCode: string) => void;
}

// A small color palette for relationship types — assigned in declaration order
// of the typeById Map. Keeps the graph readable without a per-type config.
const TYPE_COLORS = [
  "var(--color-accent)",
  "#f59e0b",
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#a78bfa",
  "#f87171",
];

const RING_R1 = 90;
const RING_R2 = 170;
const VIEWBOX = 420;

interface PositionedNode {
  code: string;
  label: string;
  level: 0 | 1 | 2;
  x: number;
  y: number;
}

function plantLabel(p: Plant | undefined, fallback: string): string {
  if (!p) return fallback;
  return p.commonName ?? p.fullName ?? p.shortCode;
}

export function RelationsSubgraph({
  centerCode,
  centerLabel,
  relationships,
  neighbors,
  typeById,
  plantsByCode,
  onSelectCode,
}: Props) {
  const colorByType = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const id of typeById.keys()) {
      m.set(id, TYPE_COLORS[i % TYPE_COLORS.length]);
      i++;
    }
    return m;
  }, [typeById]);

  const { nodes, edges } = useMemo(() => {
    const l1Codes: string[] = [];
    const l1Set = new Set<string>();
    for (const r of neighbors.get(centerCode) ?? []) {
      const other = r.from === centerCode ? r.to : r.from;
      if (other === centerCode || l1Set.has(other)) continue;
      l1Set.add(other);
      l1Codes.push(other);
    }

    // L2: neighbors of L1, excluding center + L1 itself.
    // Map each L2 code → its first L1 anchor (for positioning).
    const l2AnchorByCode = new Map<string, string>();
    for (const l1 of l1Codes) {
      for (const r of neighbors.get(l1) ?? []) {
        const other = r.from === l1 ? r.to : r.from;
        if (other === centerCode) continue;
        if (l1Set.has(other)) continue;
        if (l2AnchorByCode.has(other)) continue;
        l2AnchorByCode.set(other, l1);
      }
    }

    const positioned: PositionedNode[] = [];
    const center = VIEWBOX / 2;
    positioned.push({
      code: centerCode,
      label: centerLabel,
      level: 0,
      x: center,
      y: center,
    });

    const l1Angles = new Map<string, number>();
    const baseAngle = -Math.PI / 2;
    l1Codes.forEach((code, i) => {
      const angle = baseAngle + (i / Math.max(1, l1Codes.length)) * Math.PI * 2;
      l1Angles.set(code, angle);
      positioned.push({
        code,
        label: plantLabel(plantsByCode.get(code), code),
        level: 1,
        x: center + Math.cos(angle) * RING_R1,
        y: center + Math.sin(angle) * RING_R1,
      });
    });

    // Group L2 by anchor and fan them out in a small arc around the anchor's angle.
    const l2ByAnchor = new Map<string, string[]>();
    for (const [code, anchor] of l2AnchorByCode) {
      if (!l2ByAnchor.has(anchor)) l2ByAnchor.set(anchor, []);
      l2ByAnchor.get(anchor)!.push(code);
    }
    for (const [anchor, codes] of l2ByAnchor) {
      const anchorAngle = l1Angles.get(anchor) ?? 0;
      const spread = Math.min(Math.PI / 2.2, 0.35 * codes.length);
      codes.forEach((code, i) => {
        const t = codes.length === 1 ? 0 : i / (codes.length - 1) - 0.5;
        const angle = anchorAngle + t * spread;
        positioned.push({
          code,
          label: plantLabel(plantsByCode.get(code), code),
          level: 2,
          x: center + Math.cos(angle) * RING_R2,
          y: center + Math.sin(angle) * RING_R2,
        });
      });
    }

    const codeSet = new Set(positioned.map((n) => n.code));
    const seenEdge = new Set<number>();
    const edgesOut: Array<{
      rel: Relationship;
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
        fromX: a.x,
        fromY: a.y,
        toX: b.x,
        toY: b.y,
        color: colorByType.get(r.type) ?? "var(--color-ink-muted)",
        dir,
      });
    }

    return { nodes: positioned, edges: edgesOut };
  }, [centerCode, centerLabel, neighbors, relationships, typeById, plantsByCode, colorByType]);

  if (nodes.length === 1) {
    return (
      <p className="text-[11px] text-ink-faint italic">
        No relationships defined for this plant. Use /relate in Telegram to add one.
      </p>
    );
  }

  // Distinct types present in this subgraph — for the legend.
  const typesInUse = useMemo(() => {
    const ids = new Set(edges.map((e) => e.rel.type));
    return Array.from(ids)
      .map((id) => typeById.get(id))
      .filter((t): t is RelationshipType => !!t);
  }, [edges, typeById]);

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="w-full max-w-[420px] mx-auto"
        style={{ aspectRatio: "1 / 1" }}
      >
        <defs>
          {Array.from(colorByType.entries()).map(([id, color]) => (
            <marker
              key={id}
              id={`arr-${id}`}
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
            return (
              <line
                key={`edge-${e.rel.id}-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={e.color}
                strokeOpacity={0.55}
                strokeWidth={1.2}
                markerEnd={directed ? `url(#arr-${e.rel.type})` : undefined}
              />
            );
          })}
        </g>

        <g>
          {nodes.map((n) => {
            const r = n.level === 0 ? 18 : n.level === 1 ? 12 : 8;
            const isCenter = n.level === 0;
            return (
              <g
                key={`node-${n.code}`}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: onSelectCode && !isCenter ? "pointer" : "default" }}
                onClick={() => {
                  if (!isCenter && onSelectCode) onSelectCode(n.code);
                }}
              >
                <circle
                  r={r}
                  fill={isCenter ? "var(--color-accent)" : "var(--color-surface)"}
                  fillOpacity={isCenter ? 0.85 : 1}
                  stroke="var(--color-ink-muted)"
                  strokeOpacity={isCenter ? 0.9 : 0.6}
                  strokeWidth={isCenter ? 1.6 : 1}
                />
                <text
                  y={r + 12}
                  textAnchor="middle"
                  fontFamily="'DM Sans', sans-serif"
                  fontSize={n.level === 2 ? 9 : 11}
                  fill="var(--color-ink)"
                  fillOpacity={n.level === 2 ? 0.75 : 0.95}
                  stroke="var(--color-surface)"
                  strokeWidth={3}
                  strokeOpacity={0.85}
                  paintOrder="stroke fill"
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

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
