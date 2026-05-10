import { useMemo, useRef, useState } from "react";
import { pie as d3Pie, arc as d3Arc } from "d3-shape";
import { Cpu, Leaf, PawPrint, MapPin, Sparkles, Image as ImageIcon } from "lucide-react";
import type { AIAnalysis, AIVerdict, Plant, Species, SpeciesTaxonomy, Zone } from "../types";
import { ModelAttribution } from "./ModelAttribution";

type TaxonRank = "kingdom" | "phylum" | "class" | "order" | "family" | "genus";

const RANKS: { id: TaxonRank; label: string; plural: string }[] = [
  { id: "kingdom", label: "Kingdom", plural: "Kingdoms" },
  { id: "phylum", label: "Phylum", plural: "Phyla" },
  { id: "class", label: "Class", plural: "Classes" },
  { id: "order", label: "Order", plural: "Orders" },
  { id: "family", label: "Family", plural: "Families" },
  { id: "genus", label: "Genus", plural: "Genera" },
];

interface Props {
  plants: Plant[];
  zones: Zone[];
  speciesByShortCode: Map<string, Species>;
  aiAnalyses: AIAnalysis[];
  onSelectTaxon: (name: string) => void;
  onSpotlightZone: (zoneCode: string) => void;
  onShowBioclipConflicts: () => void;
  onShowEcoFit: (verdict: AIVerdict) => void;
}

const ECO_FIT_COLORS: Record<AIVerdict, string> = {
  GOOD: "#7fb069",
  MIXED: "#c4b76b",
  BAD: "#b08968",
};

const ECO_FIT_LABELS: Record<AIVerdict, string> = {
  GOOD: "Good",
  MIXED: "Mixed",
  BAD: "Bad",
};

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

export default function StatsPanel({
  plants,
  zones,
  speciesByShortCode,
  aiAnalyses,
  onSelectTaxon,
  onSpotlightZone,
  onShowBioclipConflicts,
  onShowEcoFit,
}: Props) {
  const stats = useMemo(
    () => computeStats(plants, zones, speciesByShortCode, aiAnalyses),
    [plants, zones, speciesByShortCode, aiAnalyses],
  );
  const [rank, setRank] = useState<TaxonRank>("family");
  const rankInfo = RANKS.find((r) => r.id === rank) ?? RANKS[4];
  const rankSlices = stats.taxa.slicesByRank[rank];
  const rankCount = stats.taxa.countsByRank[rank];

  if (plants.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm text-ink-muted">No data yet.</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 sm:px-5 space-y-6">
      <HeroBanner days={stats.daysSinceFirst} firstDate={stats.firstDate} />

      <StatTileRow tiles={[
        { icon: ImageIcon, label: "Photos", value: stats.totalPics },
        { icon: Leaf, label: "Plants", value: stats.uniquePlantSpecies, hint: `${stats.plantPicCount} photos` },
        { icon: PawPrint, label: "Animals", value: stats.uniqueAnimalSpecies, hint: `${stats.animalPicCount} photos` },
        { icon: MapPin, label: "Zones", value: stats.zonesWithPics, hint: `of ${stats.totalZones}` },
      ]} />

      <Section title="Biodiversity" subtitle="Photos grouped by taxonomic rank">
        <RankSelector value={rank} onChange={setRank} />
        {rankSlices.length > 0 ? (
          <PieChart
            slices={rankSlices}
            title={`Photos by ${rankInfo.label}`}
            centerLabel={rankInfo.plural.toUpperCase()}
            centerValue={rankCount}
            onSelect={onSelectTaxon}
          />
        ) : (
          <p className="text-xs text-ink-faint italic px-1">No {rankInfo.label.toLowerCase()} data available yet.</p>
        )}
      </Section>

      <Section title="Activity" subtitle={stats.timeline.caption}>
        <Timeline buckets={stats.timeline.buckets} />
      </Section>

      <Section title="Zones" subtitle="Where life shows up">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <HighlightCard
            label="Most photographed"
            primary={stats.topZoneByPics?.name ?? "—"}
            secondary={stats.topZoneByPics ? `${stats.topZoneByPics.count} photos` : ""}
            onClick={
              stats.topZoneByPics
                ? () => onSpotlightZone(stats.topZoneByPics!.code)
                : null
            }
          />
          <HighlightCard
            label="Most diverse"
            primary={stats.topZoneByDiversity?.name ?? "—"}
            secondary={stats.topZoneByDiversity ? `${stats.topZoneByDiversity.count} species` : ""}
            onClick={
              stats.topZoneByDiversity
                ? () => onSpotlightZone(stats.topZoneByDiversity!.code)
                : null
            }
          />
        </div>
      </Section>

      <Section
        title="Eco fit (AI)"
        subtitle="AI's read on each plant in its zone"
        info={<ModelAttribution iconSize={11} />}
      >
        {stats.ecoFit.rated > 0 ? (
          <EcoFit
            counts={stats.ecoFit.counts}
            unrated={stats.ecoFit.unrated}
            onSelect={onShowEcoFit}
          />
        ) : (
          <p className="text-xs text-ink-faint italic px-1">
            No AI analyses yet.
          </p>
        )}
      </Section>

      <Section title="Machine ID" subtitle="BioCLIP cross-checks every upload">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <MiniStat
            label="Avg confidence"
            value={stats.bioclip.avgConfidence === null ? "—" : `${Math.round(stats.bioclip.avgConfidence * 100)}%`}
          />
          <MiniStat
            label="Agreements"
            value={formatScore(stats.bioclip.agreements)}
            subline={stats.bioclip.genusOnly > 0 ? `+${stats.bioclip.genusOnly} genus` : undefined}
          />
          <MiniStat
            label="Disagreements"
            value={formatScore(stats.bioclip.disagreements)}
            accent={stats.bioclip.disagreements > 0}
            onClick={stats.bioclip.disagreements > 0 ? onShowBioclipConflicts : null}
            hint="View"
            subline={stats.bioclip.genusOnly > 0 ? `incl. ${stats.bioclip.genusOnly} genus` : undefined}
          />
          <MiniStat label="Unidentified" value={stats.unidentifiedPics} accent={stats.unidentifiedPics > 0} />
        </div>
        <p className="text-[11px] text-ink-faint leading-relaxed flex gap-2 items-start">
          <Cpu size={11} strokeWidth={1.5} className="mt-0.5 stroke-ink-faint flex-shrink-0" />
          <span>
            <a
              href="https://imageomics.github.io/bioclip/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted hover:text-accent transition-colors"
            >
              BioCLIP
            </a>{" "}
            is a foundation model trained on the Tree of Life. It guesses each
            uploaded photo's species — disagreements flag photos that may need a
            second look.
          </span>
        </p>
      </Section>
    </div>
  );
}

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function HeroBanner({ days, firstDate }: { days: number; firstDate: string | null }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-accent/20 bg-gradient-to-br from-accent/10 via-white/3 to-transparent px-5 py-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <Sparkles size={14} strokeWidth={1.5} className="stroke-accent flex-shrink-0" />
        <span className="font-display text-3xl text-ink tabular-nums tracking-tight">{days}</span>
        <span className="text-[10px] uppercase tracking-widest text-ink-muted">
          {days === 1 ? "day" : "days"} of plantyJ
        </span>
      </div>
      {firstDate && (
        <p className="text-[10px] text-ink-faint mt-1 font-mono tracking-wide">
          since {firstDate}
        </p>
      )}
    </div>
  );
}

interface Tile {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
}

function StatTileRow({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 text-ink-muted mb-1">
            <t.icon size={11} strokeWidth={1.5} className="stroke-ink-muted" />
            <span className="text-[9px] uppercase tracking-widest">{t.label}</span>
          </div>
          <p className="font-display text-xl text-ink tabular-nums leading-none">{t.value}</p>
          {t.hint && (
            <p className="text-[10px] text-ink-faint mt-1 font-mono">{t.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 px-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-ink-muted">{title}</p>
          {subtitle && (
            <p className="text-[11px] text-ink-faint mt-0.5">{subtitle}</p>
          )}
        </div>
        {info && <div className="shrink-0 mt-0.5">{info}</div>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
  onClick,
  hint,
  subline,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  onClick?: (() => void) | null;
  hint?: string;
  subline?: string;
}) {
  const interactive = !!onClick;
  const Tag = interactive ? "button" : "div";
  return (
    <Tag
      {...(interactive
        ? { type: "button" as const, onClick: onClick as () => void, title: hint ? `${hint} ${label.toLowerCase()}` : label }
        : {})}
      className={`rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-2.5 py-2 text-left ${
        interactive ? "hover:ring-accent/40 hover:bg-white/5 transition-colors cursor-pointer" : ""
      }`}
    >
      <p className="text-[9px] uppercase tracking-widest text-ink-muted mb-0.5">{label}</p>
      <p className={`font-display text-base tabular-nums leading-none ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
      {subline && (
        <p className="text-[9px] text-ink-faint mt-1 font-mono tracking-wide truncate">{subline}</p>
      )}
      {interactive && hint && (
        <p className="text-[9px] text-accent/70 mt-1 font-mono tracking-wide">{hint} →</p>
      )}
    </Tag>
  );
}

function EcoFit({
  counts,
  unrated,
  onSelect,
}: {
  counts: Record<AIVerdict, number>;
  unrated: number;
  onSelect: (verdict: AIVerdict) => void;
}) {
  const order: AIVerdict[] = ["GOOD", "MIXED", "BAD"];
  const total = order.reduce((acc, v) => acc + counts[v], 0);
  return (
    <div>
      <div
        role="group"
        aria-label="Eco fit distribution"
        className="flex h-6 rounded-md overflow-hidden ring-1 ring-inset ring-white/5 bg-white/3 mb-2"
      >
        {order.map((v) => {
          const n = counts[v];
          if (n === 0) return null;
          const pct = (n / total) * 100;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onSelect(v)}
              title={`Filter gallery to ${ECO_FIT_LABELS[v].toLowerCase()} (${n})`}
              className="flex items-center justify-center text-[10px] font-mono tabular-nums text-surface/85 hover:text-surface hover:brightness-110 transition-all cursor-pointer"
              style={{ width: `${pct}%`, backgroundColor: ECO_FIT_COLORS[v] }}
            >
              {pct >= 12 ? `${pct.toFixed(0)}%` : ""}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {order.map((v) => (
          <EcoFitTile
            key={v}
            verdict={v}
            count={counts[v]}
            total={total}
            onClick={counts[v] > 0 ? () => onSelect(v) : null}
          />
        ))}
      </div>
      {unrated > 0 && (
        <p className="text-[10px] text-ink-faint mt-2 px-1 font-mono tracking-wide">
          {unrated} {unrated === 1 ? "photo" : "photos"} not yet analyzed
        </p>
      )}
    </div>
  );
}

function EcoFitTile({
  verdict,
  count,
  total,
  onClick,
}: {
  verdict: AIVerdict;
  count: number;
  total: number;
  onClick: (() => void) | null;
}) {
  const interactive = !!onClick;
  const Tag = interactive ? "button" : "div";
  const pct = total > 0 ? (count / total) * 100 : 0;
  const color = ECO_FIT_COLORS[verdict];
  return (
    <Tag
      {...(interactive
        ? {
            type: "button" as const,
            onClick: onClick as () => void,
            title: `Filter gallery to ${ECO_FIT_LABELS[verdict].toLowerCase()}`,
          }
        : { "aria-disabled": true })}
      className={`rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-2.5 py-2 text-left ${
        interactive
          ? "hover:ring-accent/40 hover:bg-white/5 transition-colors cursor-pointer group"
          : "opacity-60"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="w-2 h-2 rounded-sm flex-shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="text-[9px] uppercase tracking-widest text-ink-muted">
          {ECO_FIT_LABELS[verdict]}
        </span>
      </div>
      <p
        className="font-display text-base tabular-nums leading-none"
        style={{ color: count > 0 ? color : undefined }}
      >
        {count}
      </p>
      {total > 0 && (
        <p className="text-[9px] text-ink-faint mt-1 font-mono tabular-nums">
          {pct.toFixed(0)}%
          {interactive && (
            <span className="text-accent/70 ml-1 group-hover:text-accent transition-colors">
              filter →
            </span>
          )}
        </p>
      )}
    </Tag>
  );
}

function HighlightCard({
  label,
  primary,
  secondary,
  onClick,
}: {
  label: string;
  primary: string;
  secondary: string;
  onClick?: (() => void) | null;
}) {
  const interactive = !!onClick;
  const Tag = interactive ? "button" : "div";
  return (
    <Tag
      {...(interactive
        ? { type: "button" as const, onClick: onClick as () => void, title: `Open ${primary}` }
        : {})}
      className={`rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-3 py-2.5 text-left w-full ${
        interactive ? "hover:ring-accent/40 hover:bg-white/5 transition-colors cursor-pointer group" : ""
      }`}
    >
      <p className="text-[9px] uppercase tracking-widest text-ink-muted mb-1">{label}</p>
      <p className={`text-sm leading-tight font-display capitalize truncate ${interactive ? "text-ink group-hover:text-accent transition-colors" : "text-ink"}`}>
        {primary}
      </p>
      {secondary && (
        <p className="text-[10px] text-ink-faint mt-0.5 font-mono">{secondary}</p>
      )}
    </Tag>
  );
}

interface Slice {
  name: string;
  value: number;
}

function RankSelector({
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

function PieChart({
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

interface TimelineBucket {
  label: string;
  date: Date;
  count: number;
}

function Timeline({ buckets }: { buckets: TimelineBucket[] }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  if (buckets.length === 0) {
    return <p className="text-xs text-ink-faint italic px-1">No activity yet.</p>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  // Inline counts get crowded once bars are too narrow; rely on hover then.
  const showInlineCounts = buckets.length <= 24;

  const updateHover = (idx: number, e: React.MouseEvent) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const hovered = hover ? buckets[hover.idx] : null;

  return (
    <div
      ref={wrapperRef}
      className="relative rounded-md bg-white/3 ring-1 ring-inset ring-white/5 px-3 py-3"
    >
      <div className="flex items-end gap-[1.5px] h-20" aria-label="Activity timeline">
        {buckets.map((b, i) => {
          const pct = (b.count / max) * 100;
          const isHovered = hover?.idx === i;
          // Show count inside bar only if it's tall enough; otherwise float above.
          const showInside = showInlineCounts && pct >= 35 && b.count > 0;
          const showAbove = showInlineCounts && !showInside && b.count > 0;
          return (
            <div
              key={i}
              className="relative flex-1 h-full flex flex-col justify-end items-center min-w-0"
              onMouseEnter={(e) => updateHover(i, e)}
              onMouseMove={(e) => updateHover(i, e)}
              onMouseLeave={() => setHover(null)}
            >
              {showAbove && (
                <span
                  className={`text-[8px] font-mono tabular-nums leading-none mb-0.5 transition-colors ${
                    isHovered ? "text-ink" : "text-ink-faint/60"
                  }`}
                >
                  {b.count}
                </span>
              )}
              <div
                className="w-full rounded-t-[1px] transition-opacity"
                style={{
                  height: `${Math.max(pct, 0.6)}%`,
                  background: "var(--color-accent)",
                  opacity: b.count > 0 ? (isHovered ? 1 : 0.85) : 0.15,
                }}
              >
                {showInside && (
                  <span
                    className={`block text-[8px] font-mono tabular-nums leading-none text-center pt-0.5 transition-colors ${
                      isHovered ? "text-surface" : "text-surface/70"
                    }`}
                  >
                    {b.count}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-ink-faint mt-1 px-0.5">
        <span>{buckets[0].label}</span>
        {buckets.length > 2 && (
          <span>{buckets[Math.floor(buckets.length / 2)].label}</span>
        )}
        <span>{buckets[buckets.length - 1].label}</span>
      </div>
      {hover && hovered && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-md border border-ink-faint/25 bg-surface-raised/95 backdrop-blur-sm px-2.5 py-1.5 shadow-lg shadow-black/40"
          style={{
            left: hover.x + 12,
            top: hover.y + 12,
            transform:
              wrapperRef.current && hover.x + 160 > wrapperRef.current.clientWidth
                ? "translateX(-100%) translateX(-24px)"
                : undefined,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: "var(--color-accent)" }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-display text-ink">{hovered.label}</span>
          </div>
          <p className="text-[10px] text-ink-muted font-mono tabular-nums">
            {hovered.count} {hovered.count === 1 ? "photo" : "photos"}
          </p>
        </div>
      )}
    </div>
  );
}

interface ComputedStats {
  totalPics: number;
  daysSinceFirst: number;
  firstDate: string | null;
  uniquePlantSpecies: number;
  uniqueAnimalSpecies: number;
  plantPicCount: number;
  animalPicCount: number;
  zonesWithPics: number;
  totalZones: number;
  taxa: {
    countsByRank: Record<TaxonRank, number>;
    slicesByRank: Record<TaxonRank, Slice[]>;
  };
  timeline: { buckets: TimelineBucket[]; caption: string };
  topZoneByPics: { code: string; name: string; count: number } | null;
  topZoneByDiversity: { code: string; name: string; count: number } | null;
  bioclip: {
    avgConfidence: number | null;
    agreements: number;
    disagreements: number;
    genusOnly: number;
  };
  unidentifiedPics: number;
  ecoFit: {
    counts: Record<AIVerdict, number>;
    rated: number;
    unrated: number;
  };
}

function computeStats(
  plants: Plant[],
  zones: Zone[],
  speciesByShortCode: Map<string, Species>,
  aiAnalyses: AIAnalysis[],
): ComputedStats {
  const totalPics = plants.length;

  // Days since seq=1 pic
  const seqOne = plants.find((p) => p.seq === 1);
  const earliest = seqOne ? new Date(seqOne.addedAt) : null;
  let daysSinceFirst = 0;
  let firstDate: string | null = null;
  if (earliest && !Number.isNaN(earliest.getTime())) {
    const now = new Date();
    daysSinceFirst = Math.max(1, Math.floor((now.getTime() - earliest.getTime()) / 86400000) + 1);
    firstDate = earliest.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Plants vs animals — split by `kind`, default to plant when missing
  const plantPics = plants.filter((p) => (p.kind ?? "plant") === "plant");
  const animalPics = plants.filter((p) => p.kind === "animal");
  const uniquePlantSpecies = new Set(plantPics.map((p) => p.shortCode)).size;
  const uniqueAnimalSpecies = new Set(animalPics.map((p) => p.shortCode)).size;

  // Zones
  const picsByZone = new Map<string, Plant[]>();
  for (const p of plants) {
    const list = picsByZone.get(p.zoneCode) ?? [];
    list.push(p);
    picsByZone.set(p.zoneCode, list);
  }
  const zoneNameByCode = new Map(zones.map((z) => [z.code, z.name ?? z.code]));
  const zoneCounts = Array.from(picsByZone.entries()).map(([code, list]) => ({
    code,
    name: zoneNameByCode.get(code) ?? code,
    count: list.length,
    diversity: new Set(list.map((p) => p.shortCode)).size,
  }));
  zoneCounts.sort((a, b) => b.count - a.count);
  const topZoneByPics = zoneCounts[0]
    ? { code: zoneCounts[0].code, name: zoneCounts[0].name, count: zoneCounts[0].count }
    : null;
  const sortedByDiversity = [...zoneCounts].sort((a, b) => b.diversity - a.diversity);
  const topZoneByDiversity = sortedByDiversity[0]
    ? { code: sortedByDiversity[0].code, name: sortedByDiversity[0].name, count: sortedByDiversity[0].diversity }
    : null;

  // Higher taxa — pull from speciesByShortCode lookups, accumulating
  // counts at every rank so the user can pivot the pie chart on any of them.
  const rankIds: TaxonRank[] = ["kingdom", "phylum", "class", "order", "family", "genus"];
  const picCountsByRank: Record<TaxonRank, Map<string, number>> = {
    kingdom: new Map(),
    phylum: new Map(),
    class: new Map(),
    order: new Map(),
    family: new Map(),
    genus: new Map(),
  };
  for (const p of plants) {
    const sp = speciesByShortCode.get(p.shortCode);
    const tx = sp?.taxonomy;
    if (!tx) continue;
    for (const r of rankIds) {
      const v = (tx as SpeciesTaxonomy)[r];
      if (!v) continue;
      const m = picCountsByRank[r];
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  const TOP_N = 8;
  const slicesByRank = {} as Record<TaxonRank, Slice[]>;
  const countsByRank = {} as Record<TaxonRank, number>;
  for (const r of rankIds) {
    const all = Array.from(picCountsByRank[r].entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    countsByRank[r] = all.length;
    if (all.length > TOP_N) {
      const top = all.slice(0, TOP_N);
      const rest = all.slice(TOP_N);
      const otherTotal = rest.reduce((acc, s) => acc + s.value, 0);
      slicesByRank[r] = [...top, { name: `Other (${rest.length})`, value: otherTotal }];
    } else {
      slicesByRank[r] = all;
    }
  }

  // Timeline auto-bucketing
  const timeline = buildTimeline(plants, earliest);

  // BioCLIP
  const scored = plants.filter(
    (p) => typeof p.bioclipScore === "number" && !Number.isNaN(p.bioclipScore),
  );
  const avgConfidence = scored.length > 0
    ? scored.reduce((acc, p) => acc + (p.bioclipScore ?? 0), 0) / scored.length
    : null;
  // Genus-only matches count as half-credit — the model got the lineage
  // right even if the species ended up wrong, so they add 0.5 to both
  // agreements and disagreements.
  let fullMatches = 0;
  let genusOnly = 0;
  let mismatches = 0;
  for (const p of plants) {
    if (!p.bioclipSpeciesId || !p.fullName) continue;
    const a = p.bioclipSpeciesId.trim().toLowerCase();
    const b = p.fullName.trim().toLowerCase();
    if (a === b) {
      fullMatches += 1;
      continue;
    }
    const genusA = a.split(/\s+/)[0];
    const genusB = b.split(/\s+/)[0];
    if (genusA && genusA === genusB) genusOnly += 1;
    else mismatches += 1;
  }
  const agreements = fullMatches + 0.5 * genusOnly;
  const disagreements = mismatches + 0.5 * genusOnly;

  // Unidentified — pics without a species fullName attached
  const unidentifiedPics = plants.filter((p) => !p.fullName).length;

  // Eco fit (AI) — verdict is keyed by (shortCode, zoneCode), so each plant
  // pic inherits the verdict of its (species, zone) pairing.
  const verdictMap = new Map<string, AIVerdict>();
  for (const a of aiAnalyses) {
    verdictMap.set(`${a.shortCode} ${a.zoneCode}`, a.verdict);
  }
  const ecoFitCounts: Record<AIVerdict, number> = { GOOD: 0, MIXED: 0, BAD: 0 };
  let ecoFitUnrated = 0;
  for (const p of plants) {
    const v = verdictMap.get(`${p.shortCode} ${p.zoneCode}`);
    if (v) ecoFitCounts[v] += 1;
    else ecoFitUnrated += 1;
  }
  const ecoFitRated = ecoFitCounts.GOOD + ecoFitCounts.MIXED + ecoFitCounts.BAD;

  return {
    totalPics,
    daysSinceFirst,
    firstDate,
    uniquePlantSpecies,
    uniqueAnimalSpecies,
    plantPicCount: plantPics.length,
    animalPicCount: animalPics.length,
    zonesWithPics: picsByZone.size,
    totalZones: zones.length,
    taxa: { countsByRank, slicesByRank },
    timeline,
    topZoneByPics,
    topZoneByDiversity,
    bioclip: { avgConfidence, agreements, disagreements, genusOnly },
    unidentifiedPics,
    ecoFit: {
      counts: ecoFitCounts,
      rated: ecoFitRated,
      unrated: ecoFitUnrated,
    },
  };
}

function buildTimeline(plants: Plant[], earliest: Date | null): { buckets: TimelineBucket[]; caption: string } {
  if (!earliest || plants.length === 0) return { buckets: [], caption: "Photos over time" };
  const now = new Date();
  const spanDays = (now.getTime() - earliest.getTime()) / 86400000;

  type Granularity = "day" | "week" | "month";
  // Adapt granularity to the span so the chart stays readable as the
  // collection grows. Recompute every time so the timeline self-scopes.
  let granularity: Granularity;
  let bucketCount: number;
  if (spanDays <= 60) {
    granularity = "day";
    bucketCount = Math.max(7, Math.ceil(spanDays) + 1);
  } else if (spanDays <= 365) {
    granularity = "week";
    bucketCount = Math.ceil(spanDays / 7) + 1;
  } else {
    granularity = "month";
    bucketCount = Math.ceil(spanDays / 30) + 1;
  }

  const buckets: TimelineBucket[] = [];
  const start = startOfBucket(earliest, granularity);
  let cursor = new Date(start);
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      label: formatBucket(cursor, granularity),
      date: new Date(cursor),
      count: 0,
    });
    cursor = advanceBucket(cursor, granularity);
    if (cursor.getTime() > now.getTime() + bucketSizeMs(granularity)) break;
  }

  for (const p of plants) {
    const d = new Date(p.addedAt);
    if (Number.isNaN(d.getTime())) continue;
    const b = startOfBucket(d, granularity).getTime();
    const idx = buckets.findIndex((bucket) => bucket.date.getTime() === b);
    if (idx >= 0) buckets[idx].count += 1;
  }

  const caption = granularity === "day"
    ? "Photos per day"
    : granularity === "week"
      ? "Photos per week"
      : "Photos per month";
  return { buckets, caption };
}

function startOfBucket(d: Date, g: "day" | "week" | "month"): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  if (g === "day") return r;
  if (g === "week") {
    r.setDate(r.getDate() - r.getDay()); // Sunday-start week
    return r;
  }
  r.setDate(1);
  return r;
}

function advanceBucket(d: Date, g: "day" | "week" | "month"): Date {
  const r = new Date(d);
  if (g === "day") r.setDate(r.getDate() + 1);
  else if (g === "week") r.setDate(r.getDate() + 7);
  else r.setMonth(r.getMonth() + 1);
  return r;
}

function bucketSizeMs(g: "day" | "week" | "month"): number {
  if (g === "day") return 86400000;
  if (g === "week") return 7 * 86400000;
  return 31 * 86400000;
}

function formatBucket(d: Date, g: "day" | "week" | "month"): string {
  if (g === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
