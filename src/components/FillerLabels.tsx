import type { NeighborMap } from "../adjacency";


// Configuration


/** Minimum filler dimension (px) along an axis to show a label on that edge. */
const MIN_LABEL_AXIS = 70;
/** Minimum filler dimension on the cross-axis so labels don't crowd. */
const MIN_CROSS_AXIS = 50;
/** Straight leader line length for top/bottom edges (px). */
const LEADER_LENGTH = 16;
/** Vertical drop before the horizontal turn on left/right leaders (px). */
const LEADER_VERT = 14;
/** Horizontal run toward the edge on left/right leaders (px). */
const LEADER_HORIZ = 16;
/** Padding from the filler edge to the label (px). */
const EDGE_PAD = 8;
/** Estimated character width at our font size for bbox estimation. */
const CHAR_W = 9;
/** Badge font size (px). */
const FONT_SIZE = 14;
/** Badge horizontal padding (px). */
const BADGE_PX = 8;
/** Badge vertical padding (px). */
const BADGE_PY = 4;
/** Leader stroke width (px). */
const STROKE_W = 2.5;
/** Badge height = font size + 2 * vertical padding. */
const BADGE_H = FONT_SIZE + BADGE_PY * 2;
/** Minimum gap between label bounding boxes (px). */
const MIN_GAP = 4;


// Name helpers


function shortLabel(text: string): string {
  return text.length > 20 ? text.slice(0, 18) + "…" : text;
}


// Types


type Edge = "top" | "bottom" | "left" | "right";

/** A label with its computed bounding box in filler-local coordinates. */
interface PositionedLabel {
  edge: Edge;
  displayName: string;
  /** Top-left x of the full label assembly (badge + leader). */
  x: number;
  /** Top-left y of the full label assembly (badge + leader). */
  y: number;
  /** Total width of the assembly. */
  w: number;
  /** Total height of the assembly. */
  h: number;
}


// Badge width estimation


function estimateBadgeWidth(text: string): number {
  return text.length * CHAR_W + BADGE_PX * 2;
}


// Overlap detection & resolution


interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + MIN_GAP &&
    a.x + a.w + MIN_GAP > b.x &&
    a.y < b.y + b.h + MIN_GAP &&
    a.y + a.h + MIN_GAP > b.y
  );
}

/**
 * Given a list of positioned labels, nudge any that overlap. Labels are
 * processed in priority order (top, bottom, left, right). If a label
 * overlaps a previously placed one, it shifts along its natural axis.
 * If it can't fit within the filler bounds after shifting, it's dropped.
 */
function resolveOverlaps(
  labels: PositionedLabel[],
  fillerW: number,
  fillerH: number
): PositionedLabel[] {
  const placed: PositionedLabel[] = [];

  for (const label of labels) {
    let candidate = { ...label };
    let fits = true;

    // Try to resolve against every already-placed label
    for (let attempts = 0; attempts < 8; attempts++) {
      const overlapping = placed.find((p) => rectsOverlap(candidate, p));
      if (!overlapping) break;

      const isHorizontal =
        candidate.edge === "top" || candidate.edge === "bottom";

      if (isHorizontal) {
        // Shift horizontally — move right past the overlapping label
        candidate.x = overlapping.x + overlapping.w + MIN_GAP;
        // Check if we've gone out of bounds
        if (candidate.x + candidate.w > fillerW - EDGE_PAD) {
          // Try shifting left instead
          candidate.x = overlapping.x - candidate.w - MIN_GAP;
          if (candidate.x < EDGE_PAD) {
            fits = false;
            break;
          }
        }
      } else {
        // Shift vertically — move down past the overlapping label
        candidate.y = overlapping.y + overlapping.h + MIN_GAP;
        if (candidate.y + candidate.h > fillerH - EDGE_PAD) {
          // Try shifting up
          candidate.y = overlapping.y - candidate.h - MIN_GAP;
          if (candidate.y < EDGE_PAD) {
            fits = false;
            break;
          }
        }
      }
    }

    // Final bounds check
    if (
      fits &&
      candidate.x >= 0 &&
      candidate.y >= 0 &&
      candidate.x + candidate.w <= fillerW &&
      candidate.y + candidate.h <= fillerH
    ) {
      placed.push(candidate);
    }
  }

  return placed;
}


// Initial positioning (before overlap resolution)


function computeInitialPosition(
  edge: Edge,
  displayName: string,
  fillerW: number,
  fillerH: number
): PositionedLabel {
  const badgeW = estimateBadgeWidth(displayName);
  const isHorizontal = edge === "top" || edge === "bottom";

  if (isHorizontal) {
    // Total assembly: badge + leader stacked vertically
    const totalH = BADGE_H + LEADER_LENGTH;
    const totalW = badgeW;
    const x = (fillerW - totalW) / 2;
    const y =
      edge === "top" ? EDGE_PAD : fillerH - EDGE_PAD - totalH;
    return { edge, displayName, x, y, w: totalW, h: totalH };
  }

  // Left/right: badge on top, elbow leader below
  const elbowW = LEADER_HORIZ + 2;
  const elbowH = LEADER_VERT + 2;
  const totalW = Math.max(badgeW, elbowW);
  const totalH = BADGE_H + elbowH;
  const y = (fillerH - totalH) / 2;
  const x =
    edge === "left"
      ? EDGE_PAD
      : fillerW - EDGE_PAD - totalW;
  return { edge, displayName, x, y, w: totalW, h: totalH };
}


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


// Component


interface FillerLabelsProps {
  neighbors: NeighborMap;
  width: number;
  height: number;
}

export default function FillerLabels({
  neighbors,
  width,
  height,
}: FillerLabelsProps) {
  if (width <= 0 || height <= 0) return null;

  // Collect candidates with space gating and deduplication
  const raw: PositionedLabel[] = [];
  const seen = new Set<string>();

  const tryAdd = (edge: Edge) => {
    const organism = neighbors[edge];
    if (!organism) return;

    const label = organism.commonName ?? organism.fullName ?? organism.shortCode;
    if (!label || seen.has(label)) return;

    const isHorizontal = edge === "top" || edge === "bottom";
    const primaryAxis = isHorizontal ? width : height;
    const crossAxis = isHorizontal ? height : width;

    if (primaryAxis < MIN_LABEL_AXIS) return;
    if (crossAxis < MIN_CROSS_AXIS) return;

    const displayName = shortLabel(label);
    seen.add(label);
    raw.push(computeInitialPosition(edge, displayName, width, height));
  };

  // Priority order
  tryAdd("top");
  tryAdd("bottom");
  tryAdd("left");
  tryAdd("right");

  if (raw.length === 0) return null;

  const positioned = resolveOverlaps(raw, width, height);
  if (positioned.length === 0) return null;

  return (
    <div className="filler-labels absolute inset-0 pointer-events-none z-[2]">
      {positioned.map((label) => (
        <div
          key={label.edge}
          className="absolute"
          style={{
            left: `${label.x}px`,
            top: `${label.y}px`,
            width: `${label.w}px`,
            height: `${label.h}px`,
          }}
        >
          <LabelAssembly
            edge={label.edge}
            displayName={label.displayName}
            boxW={label.w}
            boxH={label.h}
          />
        </div>
      ))}
    </div>
  );
}


// Label assembly — renders badge + leader within the allocated box


interface LabelAssemblyProps {
  edge: Edge;
  displayName: string;
  boxW: number;
  boxH: number;
}

function LabelAssembly({ edge, displayName, boxW }: LabelAssemblyProps) {
  if (edge === "top" || edge === "bottom") {
    return (
      <StraightAssembly edge={edge} displayName={displayName} boxW={boxW} />
    );
  }
  return <ElbowAssembly edge={edge} displayName={displayName} boxW={boxW} />;
}


// Straight assembly — top / bottom


function StraightAssembly({
  edge,
  displayName,
  boxW,
}: {
  edge: "top" | "bottom";
  displayName: string;
  boxW: number;
}) {
  const isTop = edge === "top";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isTop ? "column" : "column-reverse",
        alignItems: "center",
        width: `${boxW}px`,
        height: "100%",
      }}
    >
      <svg
        width={2}
        height={LEADER_LENGTH}
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <line
          x1={1}
          y1={0}
          x2={1}
          y2={LEADER_LENGTH}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={STROKE_W}
        />
      </svg>
      <span
        className="font-display select-none whitespace-nowrap"
        style={BADGE_STYLE}
      >
        {displayName}
      </span>
    </div>
  );
}


// Elbow assembly — left / right
// Badge on top, L-shaped leader below pointing toward the edge.


function ElbowAssembly({
  edge,
  displayName,
  boxW,
}: {
  edge: "left" | "right";
  displayName: string;
  boxW: number;
}) {
  const isLeft = edge === "left";

  const svgW = LEADER_HORIZ + 2;
  const svgH = LEADER_VERT + 2;

  const startX = isLeft ? svgW - 1 : 1;
  const midY = LEADER_VERT;
  const endX = isLeft ? 0 : svgW;

  const pathD = `M ${startX} 0 L ${startX} ${midY} L ${endX} ${midY}`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "flex-end",
        width: `${boxW}px`,
        height: "100%",
      }}
    >
      <span
        className="font-display select-none whitespace-nowrap"
        style={BADGE_STYLE}
      >
        {displayName}
      </span>
      <svg
        width={svgW}
        height={svgH}
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={STROKE_W}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}