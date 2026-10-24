import { useId, useRef, useState, useEffect } from "react";
import { Leaf, Sprout, LeafyGreen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import type { NeighborMap } from "../adjacency";
import FillerLabels from "./FillerLabels";

export const WORDS = ["PLANTYJ"];

export const LUCIDE_ICONS: LucideIcon[] = [Leaf, LeafyGreen, Sprout];

const ROTATIONS = [45, 135];
const COLORS = ["#7fb069", "#5a8c4a"];

const TEXT_FILL_COLOR = "var(--color-ink-muted)";
const ICON_FILL_COLOR = "var(--color-ink-faint)";

const STYLIZE_PLACEMENT = true;

// Higher = denser vines.
const VINE_DENSITY = 1.75;

// How much a stamp grows (relative to its resting scale) when the tile is hovered.
const HOVER_GROWTH = 1.06;

// Space Mono metrics, in em: glyph advance and cap height.
const SPACE_MONO_ADVANCE = 0.612;
const SPACE_MONO_CAP_HEIGHT = 0.7;
// Extra tracking (em) for framed labels so short uppercase text reads as a banner.
const FRAMED_TRACKING = 0.14;

export type StampDef = { type: "word"; value: string } | { type: "icon"; value: LucideIcon };

/** Build the full pool of possible stamps for external sequencing. */
export function buildStampPool(): StampDef[] {
  const pool: StampDef[] = [];
  for (const word of WORDS) {
    pool.push({ type: "word", value: word });
  }
  for (const icon of LUCIDE_ICONS) {
    pool.push({ type: "icon", value: icon });
  }
  return pool;
}

interface PlacementStyle {
  scale: number;
  offsetX: number;
  offsetY: number;
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

function generateDeterministicPlacement(index: number): PlacementStyle {
  if (!STYLIZE_PLACEMENT) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  return {
    scale: deterministicBetween(index, 1, 1.1, 2.0),
    offsetX: deterministicBetween(index, 2, 5, 200),
    offsetY: deterministicBetween(index, 3, -12, 12),
  };
}

interface StableStyle {
  rotation: number;
  color: string;
  twist: string;
  /** Resting stamp scale; hover grows from this rather than to a fixed size. */
  restScale: number;
  placement: PlacementStyle;
  iconInnerX: number;
  iconInnerY: number;
}

function generateStableStyle(
  stamp: StampDef | null,
  empty: boolean,
  fillerIndex: number,
): StableStyle {
  if (empty || !stamp) {
    return {
      rotation: ROTATIONS[fillerIndex % ROTATIONS.length],
      color: COLORS[fillerIndex % COLORS.length],
      twist: "",
      restScale: 1,
      placement: { scale: 1, offsetX: 0, offsetY: 0 },
      iconInnerX: 0,
      iconInnerY: 0,
    };
  }

  const angle = deterministicBetween(fillerIndex, 10, -3, 3);
  const scale = 1.05 + deterministicBetween(fillerIndex, 11, 0, 0.1);

  return {
    rotation: ROTATIONS[fillerIndex % ROTATIONS.length],
    color: COLORS[fillerIndex % COLORS.length],
    twist: `scale(${scale.toFixed(3)}) rotate(${angle.toFixed(2)}deg)`,
    restScale: scale,
    placement:
      stamp.type === "icon"
        ? generateDeterministicPlacement(fillerIndex)
        : { scale: 1, offsetX: 0, offsetY: 0 },
    iconInnerX: deterministicBetween(fillerIndex, 5, -10, 50),
    iconInnerY: deterministicBetween(fillerIndex, 5, -10, 30),
  };
}

/**
 * Render a Lucide icon offscreen, extract the raw SVG children,
 * and return them as an HTML string suitable for dangerouslySetInnerHTML
 * inside an <svg> mask.
 */
function extractLucideSvgContent(IconComponent: LucideIcon): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    document.body.appendChild(container);

    let cleaned = false;

    const cleanup = (root: ReturnType<typeof createRoot>) => {
      if (cleaned) return;
      cleaned = true;
      root.unmount();
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };

    const tryExtract = () => {
      const svg = container.querySelector("svg");
      return svg ? svg.innerHTML : null;
    };

    const root = createRoot(container);

    const observer = new MutationObserver(() => {
      const content = tryExtract();
      if (content) {
        observer.disconnect();
        cleanup(root);
        resolve(content);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    root.render(<IconComponent size={24} strokeWidth={2} color="black" fill="none" />);

    setTimeout(() => {
      observer.disconnect();
      const content = tryExtract();
      cleanup(root);
      resolve(content ?? "");
    }, 500);
  });
}

function useLucideExtract(IconComponent: LucideIcon | null): string | null {
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    if (!IconComponent) {
      setSvgContent(null);
      return;
    }
    let cancelled = false;
    extractLucideSvgContent(IconComponent).then((content) => {
      if (!cancelled) setSvgContent(content);
    });
    return () => {
      cancelled = true;
    };
  }, [IconComponent]);

  return svgContent;
}

interface HatchFillerProps {
  empty?: boolean;
  /** When provided, the filler uses this stamp instead of picking randomly. */
  assignedStamp?: StampDef | null;
  /**
   * Deterministic index used to cycle colors, rotations, and placement
   * styles. Assigned by MasonryGrid in layout order.
   */
  fillerIndex?: number;
  /** Adjacent organism info for rendering edge labels. */
  neighbors?: NeighborMap | null;
  /** Override fill color for word stamps (defaults to the muted ink token). */
  textColor?: string;
  /** Multiplier applied to the computed word-stamp font size. */
  textScale?: number;
  /**
   * When true, a word stamp gets an inner frame with a blurred backdrop so the
   * label (e.g. a month/year marker) stays legible over the vine pattern.
   */
  framed?: boolean;
}

export default function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
  textColor = TEXT_FILL_COLOR,
  textScale = 1,
  framed = false,
}: HatchFillerProps) {
  const patternId = useId();
  const fadeId = `${patternId}-fade`;
  const maskId = `${patternId}-mask`;
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

  const styleRef = useRef<StableStyle | null>(null);
  if (styleRef.current === null) {
    styleRef.current = generateStableStyle(stamp, empty, fillerIndex);
  }
  const { rotation, color, twist, restScale, placement, iconInnerX, iconInnerY } =
    styleRef.current;

  const iconSvgContent = useLucideExtract(stamp?.type === "icon" ? stamp.value : null);

  const patternContent = (
    <pattern
      id={patternId}
      width="16"
      height="32"
      patternUnits="userSpaceOnUse"
      patternTransform={`rotate(${rotation}) scale(${1 / VINE_DENSITY})`}
    >
      {/* sinuous vine stem (S-curve, tiles vertically) */}
      <path
        d="M 8 0 Q 15 8 8 16 T 8 32"
        stroke={color}
        strokeWidth="2.0"
        strokeOpacity="0.78"
        fill="none"
        strokeLinecap="round"
      />
      {/* leaf branching from the right-curve apex */}
      <path d="M 12 6 Q 14.5 3 15.5 6 Q 14 8 12 6 Z" fill={color} fillOpacity="0.7" />
      <path d="M 12 6 L 14 5" stroke={color} strokeWidth="0.6" strokeOpacity="0.7" fill="none" />
      {/* leaf branching from the left-curve apex */}
      <path d="M 4 22 Q 1.5 19 0.5 22 Q 2 24 4 22 Z" fill={color} fillOpacity="0.7" />
      <path d="M 4 22 L 2 21" stroke={color} strokeWidth="0.6" strokeOpacity="0.7" fill="none" />
      {/* tendril buds */}
      <circle cx="8" cy="16" r="1" fill={color} fillOpacity="0.55" />
    </pattern>
  );

  const isSmall = Math.min(size.width, size.height) < 300;

  // When the filler is very short, a stamp (word/icon) looks awkward crammed
  // into the sliver, so we render only the vine pattern.
  const isTooShortForStamp = size.height < 20;

  const baseIconSize = Math.min(size.width, size.height) * 0.7;
  const effectiveScale = isSmall
    ? Math.min(placement.scale, 1) // cap scale on mobile
    : placement.scale;
  const iconSize = Math.min(
    baseIconSize * effectiveScale,
    Math.min(size.width, size.height) * 0.95,
  );

  // Tighten offset influence on small screens
  const offsetDamping = isSmall ? 0.3 : 1.0;
  const rawCx = size.width / 2 + (placement.offsetX / 100) * size.width * offsetDamping;
  const rawCy = size.height / 2 + (placement.offsetY / 100) * size.height * offsetDamping;

  const half = iconSize / 2;

  // More generous margin
  const margin = half * (isSmall ? 0.7 : 0.3);
  const cx = Math.max(margin, Math.min(size.width - margin, rawCx));
  const cy = Math.max(margin, Math.min(size.height - margin, rawCy));

  let stampContent: React.ReactNode = null;
  let frameRect: { x: number; width: number; fadeStop: number } | null = null;

  if (!empty && !isTooShortForStamp && stamp?.type === "word" && framed) {
    const len = stamp.value.length;
    const advance = SPACE_MONO_ADVANCE + FRAMED_TRACKING;
    const fitByWidth = (size.width * 0.85) / (len * advance);
    const fontSize = Math.min(80, fitByWidth, size.height * 0.85) * textScale;
    const tracking = fontSize * FRAMED_TRACKING;
    // Browsers add tracking after the last glyph too; drop it from the measured
    // width and shift x by half so the visible glyphs sit dead center.
    const textWidth = len * advance * fontSize - tracking;

    // Dim band: a flat plateau covering the label plus padding, with a fixed
    // fade on each side, so every glyph sits on the same quiet background.
    const pad = fontSize * 0.6;
    const fade = fontSize * 1.6;
    const frameW = Math.min(size.width, textWidth + 2 * (pad + fade));
    frameRect = {
      x: (size.width - frameW) / 2,
      width: frameW,
      fadeStop: Math.max(0, (frameW - textWidth - 2 * pad) / 2 / frameW),
    };

    stampContent = (
      <text
        className="hatch-text"
        x={size.width / 2 + tracking / 2}
        // Alphabetic baseline offset by half the cap height centers the
        // uppercase/digit glyphs optically, independent of font ascent/descent.
        y={size.height / 2 + (fontSize * SPACE_MONO_CAP_HEIGHT) / 2}
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="700"
        fontSize={fontSize}
        letterSpacing={tracking}
        fill={textColor}
      >
        {stamp.value}
      </text>
    );
  } else if (!empty && !isTooShortForStamp && stamp?.type === "word") {
    // 1. Define character aspect ratio for Space Mono (width is ~60% of height)
    const charWidthRatio = 0.7;

    // 2. Define how much of the container the text is allowed to take up (e.g., 85% to leave padding)
    const maxAllowedWidth = size.width * 0.85;
    const maxAllowedHeight = size.height * 0.85;

    // 3. Calculate the maximum font size based on width
    const maxFontSizeByWidth = maxAllowedWidth / (stamp.value.length * charWidthRatio);

    // 4. Calculate the final font size (cap it at your original 80px so it doesn't get massive on large screens)
    const dynamicFontSize = Math.min(80, maxFontSizeByWidth, maxAllowedHeight) * textScale;

    stampContent = (
      <text
        className="hatch-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="'Space Mono', monospace"
        fontWeight="900"
        fontSize={dynamicFontSize}
        letterSpacing="0em"
        fill={textColor}
      >
        {stamp.value}
      </text>
    );
  } else if (!empty && !isTooShortForStamp && stamp?.type === "icon" && iconSvgContent) {
    const patchedContent = iconSvgContent.replace(/stroke="currentColor"/g, 'stroke="black"');

    stampContent = (
      <g className="hatch-text" transform={`translate(${cx - half}, ${cy - half})`}>
        <svg
          x={iconInnerX}
          y={iconInnerY}
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          overflow="visible"
          fill="none"
          stroke={ICON_FILL_COLOR}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: patchedContent }}
        />
      </g>
    );
  }

  return (
    <div
      ref={containerRef}
      className="hatch-root relative w-full h-full rounded-sm overflow-hidden"
      // Per-instance resting/hover transforms. The <style> below is global, so
      // they can't be interpolated into it or every filler would share the
      // last-rendered instance's values. Framed labels stay level.
      style={
        {
          "--hatch-twist": framed || !twist ? "none" : twist,
          "--hatch-hover": `scale(${((framed ? 1 : restScale) * HOVER_GROWTH).toFixed(3)})`,
        } as React.CSSProperties
      }
    >
      <style>{`
        .hatch-text {
          transform: var(--hatch-twist);
          transition: transform 0.4s cubic-bezier(0.34, 1.15, 0.64, 1);
          transform-origin: center center;
        }
        .hatch-root:hover .hatch-text {
          transform: var(--hatch-hover);
        }
        .filler-labels {
          opacity: 0;
          transform: scale(0.92);
          transition: opacity 0.25s ease-out, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
          pointer-events: none;
        }
        .hatch-root:hover .filler-labels {
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
          {patternContent}
          {frameRect && (
            <>
              {/* Luminance gradient: white = full-opacity lines, the mid gray
                  fades the vine lines down in the central band so the label
                  reads clearly. Edges return to white so the band dissolves
                  into the sharp pattern instead of ending abruptly. */}
              <linearGradient
                id={fadeId}
                gradientUnits="userSpaceOnUse"
                x1={frameRect.x}
                y1="0"
                x2={frameRect.x + frameRect.width}
                y2="0"
              >
                <stop offset="0" stopColor="white" />
                <stop offset={frameRect.fadeStop} stopColor="#3a3a3a" />
                <stop offset={1 - frameRect.fadeStop} stopColor="#3a3a3a" />
                <stop offset="1" stopColor="white" />
              </linearGradient>
              {/* Mask applied to the vine pattern only: opaque everywhere,
                  dimmed across the band. The background fill stays untouched,
                  so no second background tone appears in the center. */}
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={frameRect.x}
                  y={0}
                  width={frameRect.width}
                  height="100%"
                  fill={`url(#${fadeId})`}
                />
              </mask>
            </>
          )}
        </defs>
        <rect width="100%" height="100%" fill="var(--color-surface-raised, #1a1a1a)" />
        <rect
          width="100%"
          height="100%"
          fill={`url(#${patternId})`}
          mask={frameRect ? `url(#${maskId})` : undefined}
        />
        {stampContent}
      </svg>

      {neighbors && <FillerLabels neighbors={neighbors} width={size.width} height={size.height} />}
    </div>
  );
}
