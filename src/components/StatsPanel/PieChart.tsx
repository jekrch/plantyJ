import { useMemo, useRef, useState } from "react";
import { pie as d3Pie, arc as d3Arc } from "d3-shape";
import { RANKS, type Slice, type TaxonRank } from "../../utils/stats";

const PALETTE = [
  "#7fb069",
  "#a8c97a",
  "#5a8c4a",
  "#c4b76b",
  "#8a9b6c",
  "#6b8b73",
  "#b08c4a",
  "#9b7a4a",
  "#4a6b5a",
  "#c7a87a",
];

export function RankSelector({
  value,
  onChange,
}: {
  value: TaxonRank;
  onChange: (r: TaxonRank) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Taxonomic rank"
      className="flex flex-wrap gap-1 mb-3 px-1"
    >
      {RANKS.map((r) => {
        const active = r.id === value;
        return (
          <button
            key={r.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(r.id)}
            className={`px-2.5 py-1 text-[10px] uppercase tracking-widest rounded-md transition-colors ${
              active
                ? "bg-accent/20 text-accent ring-1 ring-inset ring-accent/40"
                : "bg-white/3 text-ink-muted ring-1 ring-inset ring-white/5 hover:text-ink hover:bg-white/5"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

export function PieChart({
  slices,
  title,
  centerLabel,
  centerValue,
  onSelect,
}: {
  slices: Slice[];
  title: string;
  centerLabel: string;
  centerValue: number;
  onSelect?: (name: string) => void;
}) {
  const size = 160;
  const radius = size / 2;
  const inner = radius * 0.55;
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const arcs = useMemo(() => {
    const generator = d3Pie<Slice>().value((d) => d.value).sort(null);
    const arcGen = d3Arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(inner)
      .outerRadius(radius)
      .padAngle(0.012)
      .cornerRadius(2);
    return generator(slices).map((p, i) => ({
      d: arcGen({ startAngle: p.startAngle, endAngle: p.endAngle }) ?? "",
      color: PALETTE[i % PALETTE.length],
      data: p.data,
    }));
  }, [slices, inner, radius]);

  const updateHover = (idx: number, e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hovered = hover ? arcs[hover.idx] : null;
  const hoveredPct = hovered && total > 0 ? (hovered.data.value / total) * 100 : 0;

  return (
    <div
      ref={wrapperRef}
      className="relative rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-3 py-3 flex flex-col sm:flex-row items-center gap-4"
    >
      <svg
        width={size}
        height={size}
        viewBox={`${-radius} ${-radius} ${size} ${size}`}
        className="flex-shrink-0"
        role="img"
        aria-label={title}
      >
        {arcs.map((a, i) => {
          const isOther = a.data.name.startsWith("Other (");
          const interactive = !!onSelect && !isOther;
          const isHovered = hover?.idx === i;
          return (
            <path
              key={i}
              d={a.d}
              fill={a.color}
              opacity={isHovered ? 1 : 0.92}
              className={`transition-opacity ${interactive ? "cursor-pointer" : ""}`}
              onClick={interactive ? () => onSelect!(a.data.name) : undefined}
              onMouseEnter={(e) => updateHover(i, e)}
              onMouseMove={(e) => updateHover(i, e)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <text
          x={0}
          y={-2}
          textAnchor="middle"
          className="fill-ink"
          style={{ fontFamily: "Space Mono, monospace", fontSize: 18 }}
        >
          {centerValue}
        </text>
        <text
          x={0}
          y={12}
          textAnchor="middle"
          className="fill-ink-muted"
          style={{ fontFamily: "Space Mono, monospace", fontSize: 7, letterSpacing: "0.15em" }}
        >
          {centerLabel}
        </text>
      </svg>
      <div role="list" className="flex-1 min-w-0 grid grid-cols-1 gap-0.5 w-full">
        {arcs.map((a, i) => {
          const pct = total > 0 ? (a.data.value / total) * 100 : 0;
          const isOther = a.data.name.startsWith("Other (");
          const interactive = !!onSelect && !isOther;
          const className = `flex items-center gap-2 text-[11px] min-w-0 px-1.5 py-0.5 rounded text-left w-full ${
            interactive ? "hover:bg-white/5 transition-colors cursor-pointer group" : ""
          }`;
          const inner = (
            <>
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: a.color }}
                aria-hidden="true"
              />
              <span className={`truncate flex-1 font-display ${interactive ? "text-ink group-hover:text-accent transition-colors" : "text-ink"}`}>
                {a.data.name}
              </span>
              <span className="text-ink-faint font-mono tabular-nums">
                {a.data.value}
              </span>
              <span className="text-ink-muted font-mono tabular-nums w-10 text-right">
                {pct.toFixed(0)}%
              </span>
            </>
          );
          return interactive ? (
            <button
              key={i}
              role="listitem"
              type="button"
              onClick={() => onSelect!(a.data.name)}
              onMouseEnter={(e) => updateHover(i, e)}
              onMouseMove={(e) => updateHover(i, e)}
              onMouseLeave={() => setHover(null)}
              className={className}
            >
              {inner}
            </button>
          ) : (
            <div
              key={i}
              role="listitem"
              className={className}
              onMouseEnter={(e) => updateHover(i, e)}
              onMouseMove={(e) => updateHover(i, e)}
              onMouseLeave={() => setHover(null)}
            >
              {inner}
            </div>
          );
        })}
      </div>
      {hover && hovered && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-md border border-ink-faint/25 bg-surface-raised/95 backdrop-blur-sm px-2.5 py-1.5 shadow-lg shadow-black/40"
          style={{
            left: hover.x + 12,
            top: hover.y + 12,
            transform:
              wrapperRef.current && hover.x + 180 > wrapperRef.current.clientWidth
                ? "translateX(-100%) translateX(-24px)"
                : undefined,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: hovered.color }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-display text-ink">{hovered.data.name}</span>
          </div>
          <p className="text-[10px] text-ink-muted font-mono tabular-nums">
            {hovered.data.value} {hovered.data.value === 1 ? "photo" : "photos"} · {hoveredPct.toFixed(1)}%
          </p>
        </div>
      )}
    </div>
  );
}
