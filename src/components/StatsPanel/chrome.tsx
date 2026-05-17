import { Sparkles } from "lucide-react";

export function HeroBanner({ days, firstDate }: { days: number; firstDate: string | null }) {
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

export interface Tile {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
}

export function StatTileRow({ tiles }: { tiles: Tile[] }) {
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

export function Section({
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

export function MiniStat({
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

export function HighlightCard({
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
