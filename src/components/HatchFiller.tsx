import { useId, useRef, useState, useEffect } from "react";
import { Leaf, Sprout, LeafyGreen} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import type { NeighborMap } from "../adjacency";
import FillerLabels from "./FillerLabels";

export const WORDS = ["PLANTYJ"];

export const LUCIDE_ICONS: LucideIcon[] = [
  Leaf,
  LeafyGreen,
  Sprout,
];

const ROTATIONS = [45, 135];
const COLORS = ["#7fb069", "#5a8c4a"];

const TEXT_FILL_COLOR = "var(--color-ink-muted)";
const ICON_FILL_COLOR = "var(--color-ink-faint)";


const STYLIZE_PLACEMENT = true;

// Higher = denser vines. 
const VINE_DENSITY = 1.75;

export type StampDef =
  | { type: "word"; value: string }
  | { type: "icon"; value: LucideIcon };

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
  return min + (h % 10000) / 10000 * (max - min);
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
  placement: PlacementStyle;
  iconInnerX: number;
  iconInnerY: number;
}

function generateStableStyle(stamp: StampDef | null, empty: boolean, fillerIndex: number): StableStyle {
  if (empty || !stamp) {
    return {
      rotation: ROTATIONS[fillerIndex % ROTATIONS.length],
      color: COLORS[fillerIndex % COLORS.length],
      twist: "",
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

    root.render(
      <IconComponent size={24} strokeWidth={2} color="black" fill="none" />
    );

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
    return () => { cancelled = true; };
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
}

export default function HatchFiller({
  empty = false,
  assignedStamp = null,
  fillerIndex = 0,
  neighbors = null,
}: HatchFillerProps) {
  const patternId = useId();
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
  const { rotation, color, twist, placement, iconInnerX, iconInnerY } = styleRef.current;

  const iconSvgContent = useLucideExtract(
    stamp?.type === "icon" ? stamp.value : null
  );

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
      <path
        d="M 12 6 Q 14.5 3 15.5 6 Q 14 8 12 6 Z"
        fill={color}
        fillOpacity="0.7"
      />
      <path
        d="M 12 6 L 14 5"
        stroke={color}
        strokeWidth="0.6"
        strokeOpacity="0.7"
        fill="none"
      />
      {/* leaf branching from the left-curve apex */}
      <path
        d="M 4 22 Q 1.5 19 0.5 22 Q 2 24 4 22 Z"
        fill={color}
        fillOpacity="0.7"
      />
      <path
        d="M 4 22 L 2 21"
        stroke={color}
        strokeWidth="0.6"
        strokeOpacity="0.7"
        fill="none"
      />
      {/* tendril buds */}
      <circle cx="8" cy="16" r="1" fill={color} fillOpacity="0.55" />
    </pattern>
  );


  const isSmall = Math.min(size.width, size.height) < 300;

  const baseIconSize = Math.min(size.width, size.height) * 0.7;
  const effectiveScale = isSmall
    ? Math.min(placement.scale, 1)   // cap scale on mobile
    : placement.scale;
  const iconSize = Math.min(
    baseIconSize * effectiveScale,
    Math.min(size.width, size.height) * 0.95
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

  if (!empty && stamp?.type === "word") {
    // 1. Define character aspect ratio for Space Mono (width is ~60% of height)
    const charWidthRatio = 0.7; 
    
    // 2. Define how much of the container the text is allowed to take up (e.g., 85% to leave padding)
    const maxAllowedWidth = size.width * 0.85;
    const maxAllowedHeight = size.height * 0.85;
    
    // 3. Calculate the maximum font size based on width
    const maxFontSizeByWidth = maxAllowedWidth / (stamp.value.length * charWidthRatio);
    
    // 4. Calculate the final font size (cap it at your original 80px so it doesn't get massive on large screens)
    const dynamicFontSize = Math.min(80, maxFontSizeByWidth, maxAllowedHeight);

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
        fill={TEXT_FILL_COLOR}
      >
        {stamp.value}
      </text>
    );
  } else if (!empty && stamp?.type === "icon" && iconSvgContent) {
    const patchedContent = iconSvgContent.replace(
      /stroke="currentColor"/g,
      'stroke="black"'
    );

    stampContent = (
      <g
        className="hatch-text"
        transform={`translate(${cx - half}, ${cy - half})`}
      >
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
    <div ref={containerRef} className="hatch-root relative w-full h-full rounded-sm overflow-hidden">
      <style>{`
        .hatch-text {
          transform: ${twist};
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform-origin: center center;
        }
        .hatch-root:hover .hatch-text {
          transform: scale(1.2) rotate(0deg);
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
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--color-surface-raised, #1a1a1a)"
        />
        <rect
          width="100%"
          height="100%"
          fill={`url(#${patternId})`}
        />
        {stampContent}
      </svg>

      {neighbors && (
        <FillerLabels
          neighbors={neighbors}
          width={size.width}
          height={size.height}
        />
      )}
    </div>
  );
}