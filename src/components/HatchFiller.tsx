import { memo, useId, useRef, useState, useEffect } from "react";
import type { NeighborMap } from "../adjacency";
import type { EdgeSpans } from "./fillerLabelLayout";
import FillerLabels, { MergedFillerLabels, type MergedLabelMember } from "./FillerLabels";

// Block-print inks: tone-on-tone greens on the raised surface, plus a muted
// ochre used sparingly for berries. Opaque on purpose — the leaf veins are
// "cut" by drawing them in the paper color. Two leaf tones alternate between
// the corner and half-drop sprigs, like a two-block print, so the repeat has
// depth instead of reading as one flat stamp.
// The paper sits just above the page background (--color-surface, #0b140d) so
// fillers read as part of the page rather than raised cards.
const PAPER = "#0d1710";
const INK_STEM_FRONT = "#203c28";
const INK_STEM_BACK = "#1a3022";
const INK_LEAF_FRONT = "#2b4d33";
const INK_LEAF_BACK = "#1f3927";
const INK_BERRY = "#594b30";

// Lighting: a soft wash from the upper left and a gentle falloff toward the
// edges, so each filler sits like an inset panel of paper rather than a flat
// fill. Both are very low opacity on purpose.
const LIGHT_OPACITY = 0.07;
const SHADE_OPACITY = 0.28;

// Pattern strength behind month labels, relative to regular fillers.
const MONTH_PATTERN_OPACITY = 0.6;

// Month labels never set larger than the header logo (text-xl).
const MONTH_MAX_FONT_SIZE = 20;

const TEXT_FILL_COLOR = "var(--color-ink-muted)";

// Overall motif size multiplier.
const PATTERN_SCALE = 1.8;

// Space Mono metrics, in em: glyph advance and cap height.
const SPACE_MONO_ADVANCE = 0.612;
const SPACE_MONO_CAP_HEIGHT = 0.7;
// Tracking (em) for month labels, matching the header logo's `tracking-tight`.
const LABEL_TRACKING = -0.025;

// Matches Tailwind's `rounded-sm`, so merged bodies keep the single-filler corners.
export const CORNER_RADIUS = 4;

export type StampDef = { type: "word"; value: string } | { type: "blank" };

export interface FillerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One filler inside a merged body, positioned relative to the body's bounding box. */
export type FillerMember = MergedLabelMember;

/**
 * Adjacent fillers drawn as one body: the member rects plus bridges over the
 * gaps between them, all relative to the body's bounding box.
 */
export interface FillerShape {
  members: FillerMember[];
  bridges: FillerRect[];
}

/** Build the full pool of possible stamps for external sequencing. */
export function buildStampPool(): StampDef[] {
  // Regular fillers are plain wallpaper; only month markers carry a word.
  return [{ type: "blank" }];
}

/**
 * A simple integer hash that maps an index to a spread-out but
 * deterministic value, used to give each filler varied-looking
 * placement without any randomness.
 */
function deterministicHash(index: number): number {
  let h = index * 2654435761; // Knuth multiplicative hash
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = (h >>> 16) ^ h;
  return Math.abs(h);
}

/** Map an index deterministically into the [min, max) range. */
function deterministicBetween(index: number, salt: number, min: number, max: number): number {
  const h = deterministicHash(index * 7 + salt);
  return min + ((h % 10000) / 10000) * (max - min);
}

// Motifs
//
// All motifs are drawn in pattern units around their own origin. Repeats are
// a half-drop: one motif on each tile corner and one (usually mirrored) in the
// center, with copies on the neighboring lattice points so anything crossing
// a tile edge wraps seamlessly.

/**
 * A willow-style leaf with its base at the origin, pointing up (-y). `curl`
 * bends the tip sideways so leaves read as hand-cut rather than geometric.
 */
function Leaf({
  x,
  y,
  angle,
  len,
  wid,
  curl = 1,
  fill,
}: {
  x: number;
  y: number;
  angle: number;
  len: number;
  wid: number;
  curl?: number;
  fill: string;
}) {
  const d =
    `M 0 0 C ${wid * 0.95} ${-len * 0.25}, ${wid * 0.7 + curl} ${-len * 0.72}, ${curl} ${-len} ` +
    `C ${-wid * 0.45 + curl} ${-len * 0.7}, ${-wid * 0.95} ${-len * 0.32}, 0 0 Z`;
  const vein = `M 0 ${-len * 0.14} Q ${wid * 0.12 + curl * 0.3} ${-len * 0.55}, ${curl * 0.82} ${-len * 0.86}`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d={d} fill={fill} />
      <path d={vein} stroke={PAPER} strokeWidth={0.55} strokeLinecap="round" fill="none" />
    </g>
  );
}

function Berries({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill={INK_BERRY}>
      <circle cx={0} cy={0} r={1.3} />
      <circle cx={-2.2} cy={1.8} r={1.1} />
      <circle cx={-1.7} cy={-2.1} r={1} />
    </g>
  );
}

/** A gently S-curved stem with alternating leaves and a berry spray. */
function WillowSprig({ leaf, stem }: { leaf: string; stem: string }) {
  return (
    <g>
      <path
        d="M -2 22 C 8 10, -8 -6, 3 -22"
        stroke={stem}
        strokeWidth={1.15}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 0.3 18.3 Q -3 18, -5.4 15.6"
        stroke={stem}
        strokeWidth={0.8}
        strokeLinecap="round"
        fill="none"
      />
      <Berries x={-5.6} y={15.4} />
      <Leaf x={1.3} y={14.4} angle={56} len={13} wid={3.3} curl={1.4} fill={leaf} />
      <Leaf x={0.9} y={5.9} angle={-62} len={14} wid={3.5} curl={-1.2} fill={leaf} />
      <Leaf x={-0.6} y={-3.1} angle={50} len={14} wid={3.4} curl={1.2} fill={leaf} />
      <Leaf x={-0.8} y={-12.4} angle={-48} len={12} wid={3.1} curl={-1} fill={leaf} />
      <Leaf x={3} y={-22} angle={14} len={9.5} wid={2.8} curl={0.8} fill={leaf} />
    </g>
  );
}

const WILLOW_TILE = { w: 46, h: 64 };

/** Render `corner` on every tile corner and `center` at the half-drop point. */
function HalfDrop({
  w,
  h,
  corner,
  center,
}: {
  w: number;
  h: number;
  corner: React.ReactNode;
  center: React.ReactNode;
}) {
  const uses: React.ReactNode[] = [];
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      uses.push(
        <g key={`c${i}${j}`} transform={`translate(${i * w + w} ${j * h + h})`}>
          {corner}
        </g>,
        <g key={`m${i}${j}`} transform={`translate(${i * w + w / 2} ${j * h + h / 2})`}>
          {center}
        </g>,
      );
    }
  }
  return <>{uses}</>;
}

interface HatchFillerProps {
  empty?: boolean;
  /** When provided, the filler uses this stamp instead of picking from the pool. */
  assignedStamp?: StampDef | null;
  /**
   * Deterministic index used to offset the pattern's phase. Assigned by
   * MasonryGrid in layout order.
   */
  fillerIndex?: number;
  /** Adjacent organism info for rendering edge labels. */
  neighbors?: NeighborMap | null;
  /** Override fill color for word stamps (defaults to the muted ink token). */
  textColor?: string;
  /** Multiplier applied to the computed word-stamp font size. */
  textScale?: number;
  /**
   * When true, a word stamp is set over the pattern (e.g. a month/year
   * marker). Unframed word stamps aren't rendered.
   */
  framed?: boolean;
  /**
   * When set, this filler is several adjacent fillers merged into one body.
   * The container spans their bounding box; paint is clipped to the members
   * and bridges, and the whole body shares one set of edge labels.
   */
  shape?: FillerShape | null;
}

function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
  textColor = TEXT_FILL_COLOR,
  textScale = 1,
  framed = false,
  shape = null,
}: HatchFillerProps) {
  const patternId = useId();
  const lightId = `${patternId}-light`;
  const shadeId = `${patternId}-shade`;
  const clipId = `${patternId}-clip`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    update();
    const t1 = setTimeout(update, 150);
    const t2 = setTimeout(update, 500);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const stampRef = useRef<StampDef | null>(null);
  if (stampRef.current === null && !empty) {
    if (assignedStamp) {
      stampRef.current = assignedStamp;
    } else {
      const pool = buildStampPool();
      stampRef.current = pool[fillerIndex % pool.length];
    }
  }
  const stamp = stampRef.current;

  const tile = WILLOW_TILE;
  // Shift each filler's repeat so neighboring fillers don't all start on the
  // same motif at their top-left corner.
  const phaseX = deterministicBetween(fillerIndex, 2, 0, tile.w);
  const phaseY = deterministicBetween(fillerIndex, 3, 0, tile.h);

  let stampContent: React.ReactNode = null;
  const word = !empty && stamp?.type === "word" && stamp.value ? stamp.value : null;

  if (word && framed) {
    const len = word.length;
    const advance = SPACE_MONO_ADVANCE + LABEL_TRACKING;
    const fitByWidth = (size.width * 0.85) / (len * advance);
    const fontSize = Math.min(MONTH_MAX_FONT_SIZE, fitByWidth * textScale, size.height * 0.85 * textScale);
    const tracking = fontSize * LABEL_TRACKING;

    stampContent = (
      <>
        <text
          // Browsers add tracking after the last glyph too; shift x by half of
          // it so the visible glyphs sit dead center.
          x={size.width / 2 + tracking / 2}
          // Alphabetic baseline offset by half the cap height centers the
          // capitals/digits optically, independent of font ascent/descent.
          y={size.height / 2 + (fontSize * SPACE_MONO_CAP_HEIGHT) / 2}
          textAnchor="middle"
          fontFamily="'Space Mono', monospace"
          fontWeight="700"
          fontSize={fontSize}
          letterSpacing={tracking}
          fill={textColor}
        >
          {word}
        </text>
      </>
    );
  }

  // A merged body's bounding box can reach over a neighboring card, so only
  // the members themselves take the pointer.
  const clip = shape ? `url(#${clipId})` : undefined;

  return (
    <div
      ref={containerRef}
      className={`hatch-root relative w-full h-full overflow-hidden ${
        shape ? "hatch-merged pointer-events-none" : "rounded-sm"
      }`}
    >
      <style>{`
        .filler-labels {
          opacity: 0;
          transform: scale(0.92);
          transition: opacity 0.25s ease-out, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
          pointer-events: none;
        }
        .hatch-root:not(.hatch-merged):hover .filler-labels,
        .hatch-merged:has(.hatch-hit:hover) .filler-labels {
          opacity: 1;
          transform: scale(1);
        }
      `}</style>
      <svg
        className="hatch-container"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id={patternId}
            width={tile.w}
            height={tile.h}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${phaseX.toFixed(1)} ${phaseY.toFixed(1)}) scale(${PATTERN_SCALE})`}
          >
            <HalfDrop
              w={tile.w}
              h={tile.h}
              corner={<WillowSprig leaf={INK_LEAF_FRONT} stem={INK_STEM_FRONT} />}
              center={
                <g transform="scale(-1 1)">
                  <WillowSprig leaf={INK_LEAF_BACK} stem={INK_STEM_BACK} />
                </g>
              }
            />
          </pattern>
          <radialGradient id={lightId} cx="0.3" cy="0.2" r="0.9">
            <stop offset="0" stopColor="#e8f2df" stopOpacity={LIGHT_OPACITY} />
            <stop offset="1" stopColor="#e8f2df" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={shadeId} cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.55" stopColor="#050a06" stopOpacity="0" />
            <stop offset="1" stopColor="#050a06" stopOpacity={SHADE_OPACITY} />
          </radialGradient>
          {shape && (
            <clipPath id={clipId}>
              {shape.members.map((m) => (
                <rect
                  key={m.key}
                  x={m.x}
                  y={m.y}
                  width={m.w}
                  height={m.h}
                  rx={CORNER_RADIUS}
                />
              ))}
              {shape.bridges.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} />
              ))}
            </clipPath>
          )}
        </defs>
        {/* One pattern, light and shade across the whole body, so merged
            fillers read as a single sheet with no seam at the joins. */}
        <g clipPath={clip}>
          <rect width="100%" height="100%" fill={PAPER} />
          <rect
            width="100%"
            height="100%"
            fill={`url(#${patternId})`}
            // Month strips are short, so motifs land right against the glyphs;
            // an even dim (no band, no edge) keeps the text clean.
            opacity={framed ? MONTH_PATTERN_OPACITY : 1}
          />
          {/* The lighting gradients scale with the box, so on a wide, short
              month strip they smear into soft bands along the edges. */}
          {!framed && (
            <>
              <rect width="100%" height="100%" fill={`url(#${lightId})`} />
              <rect width="100%" height="100%" fill={`url(#${shadeId})`} />
            </>
          )}
        </g>
        {stampContent}
      </svg>

      {shape ? (
        <>
          {/* Hover targets covering the body itself, bridges included, so the
              labels come up anywhere on it and nowhere else in its box. */}
          {[...shape.members, ...shape.bridges].map((r, i) => (
            <div
              key={i}
              className="hatch-hit absolute pointer-events-auto"
              style={{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }}
            />
          ))}
          <MergedFillerLabels members={shape.members} />
        </>
      ) : (
        neighbors && <FillerLabels neighbors={neighbors} width={size.width} height={size.height} />
      )}
    </div>
  );
}

/** Neighbor maps are rebuilt object-fresh on every layout; compare the organisms they hold. */
function sameNeighbors(a: NeighborMap | null | undefined, b: NeighborMap | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

function sameSpans(a: EdgeSpans | undefined, b: EdgeSpans | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (["top", "bottom", "left", "right"] as const).every(
    (e) => a[e]?.[0] === b[e]?.[0] && a[e]?.[1] === b[e]?.[1],
  );
}

/** Merged shapes are rebuilt on every layout; compare their geometry and neighbors. */
function sameShape(a: FillerShape | null | undefined, b: FillerShape | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.members.length !== b.members.length || a.bridges.length !== b.bridges.length) return false;
  const sameRect = (r: FillerRect, q: FillerRect) =>
    r.x === q.x && r.y === q.y && r.w === q.w && r.h === q.h;
  return (
    a.members.every(
      (m, i) =>
        m.key === b.members[i].key &&
        sameRect(m, b.members[i]) &&
        sameNeighbors(m.neighbors, b.members[i].neighbors) &&
        sameSpans(m.spans, b.members[i].spans),
    ) && a.bridges.every((r, i) => sameRect(r, b.bridges[i]))
  );
}

/** Month markers pass a fresh stamp literal each render; compare by content. */
function sameStamp(a: StampDef | null | undefined, b: StampDef | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  return a.type === "blank" || a.value === (b as typeof a).value;
}

// MasonryGrid relayouts on every frame while the filter/sort panels expand, and
// each filler carries an SVG pattern stack plus a ResizeObserver. Re-render only
// when what it draws actually changes.
export default memo(
  HatchFiller,
  (prev, next) =>
    prev.empty === next.empty &&
    prev.fillerIndex === next.fillerIndex &&
    prev.textColor === next.textColor &&
    prev.textScale === next.textScale &&
    prev.framed === next.framed &&
    sameStamp(prev.assignedStamp, next.assignedStamp) &&
    sameNeighbors(prev.neighbors, next.neighbors) &&
    sameShape(prev.shape, next.shape),
);
