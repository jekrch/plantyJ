import { useMemo } from "react";
import type { NeighborMap } from "../adjacency";
import {
  BADGE_PX,
  BADGE_PY,
  FONT_SIZE,
  layoutFillerLabels,
  layoutMergedFillerLabels,
  STROKE_W,
  type EdgeSpans,
  type Leader,
  type PlacedLabel,
} from "./fillerLabelLayout";

// Badge style (shared)

const BADGE_STYLE: React.CSSProperties = {
  fontSize: `${FONT_SIZE}px`,
  padding: `${BADGE_PY}px ${BADGE_PX}px`,
  backgroundColor: "rgba(255, 255, 255, 0.92)",
  color: "#111",
  borderRadius: "2px",
  letterSpacing: "0.02em",
  lineHeight: 1,
};

const LEADER_STROKE = "rgba(255,255,255,0.85)";

// Component

interface FillerLabelsProps {
  neighbors: NeighborMap;
  width: number;
  height: number;
}

/**
 * Names of the plants bordering this filler. One badge per name, with a leader
 * to every edge it borders — a plant on two sides gets two lines from the same
 * badge rather than a second badge.
 */
export default function FillerLabels({ neighbors, width, height }: FillerLabelsProps) {
  // The placement search is a pruned DFS over every badge slot; only a resize
  // or a neighbor change can move a label.
  const labels = useMemo(
    () => layoutFillerLabels(neighbors, width, height),
    [neighbors, width, height],
  );
  if (labels.length === 0) return null;

  return (
    <div className="filler-labels absolute inset-0 pointer-events-none z-[2]">
      <LabelSet labels={labels} width={width} height={height} />
    </div>
  );
}

/** One filler of a merged body, positioned relative to the body's bounding box. */
export interface MergedLabelMember {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  neighbors: NeighborMap;
  spans?: EdgeSpans;
}

/**
 * Labels for adjacent fillers merged into one body. They are laid out per
 * filler but as one set — each plant named once for the whole body — and
 * revealed together, since the body reads as a single surface.
 */
export function MergedFillerLabels({ members }: { members: MergedLabelMember[] }) {
  const perMember = useMemo(() => layoutMergedFillerLabels(members), [members]);
  if (perMember.every((labels) => labels.length === 0)) return null;

  return (
    <div className="filler-labels absolute inset-0 pointer-events-none z-[2]">
      {members.map((m, i) =>
        perMember[i].length > 0 ? (
          <div
            key={m.key}
            className="absolute"
            style={{ left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` }}
          >
            <LabelSet labels={perMember[i]} width={m.w} height={m.h} />
          </div>
        ) : null,
      )}
    </div>
  );
}

/** Leaders and badges for one filler's labels, in that filler's coordinates. */
function LabelSet({
  labels,
  width,
  height,
}: {
  labels: PlacedLabel[];
  width: number;
  height: number;
}) {
  return (
    <>
      {/* All leaders share one canvas so they can be routed against each other. */}
      <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
        {labels.map((label) =>
          label.leaders.map((leader) => (
            <LeaderLine key={`${label.name}-${leader.edge}`} leader={leader} />
          )),
        )}
      </svg>

      {labels.map((label) => (
        <div
          key={label.name}
          className="absolute flex justify-center"
          style={{
            left: `${label.x}px`,
            top: `${label.y}px`,
            width: `${label.w}px`,
            height: `${label.h}px`,
          }}
        >
          <span className="font-display select-none whitespace-nowrap" style={BADGE_STYLE}>
            {label.displayName}
          </span>
        </div>
      ))}
    </>
  );
}

// Leader — a polyline from the badge out to the edge it names

function LeaderLine({ leader }: { leader: Leader }) {
  return (
    <polyline
      points={leader.points.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      stroke={LEADER_STROKE}
      strokeWidth={STROKE_W}
      strokeLinejoin="round"
    />
  );
}
