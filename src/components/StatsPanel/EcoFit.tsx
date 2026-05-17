import type { AIVerdict } from "../../types";

export const ECO_FIT_COLORS: Record<AIVerdict, string> = {
  GOOD: "#7fb069",
  MIXED: "#c4b76b",
  BAD: "#b08968",
};

export const ECO_FIT_LABELS: Record<AIVerdict, string> = {
  GOOD: "Good",
  MIXED: "Mixed",
  BAD: "Bad",
};

export function EcoFit({
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
