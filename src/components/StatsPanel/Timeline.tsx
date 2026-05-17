import { useRef, useState } from "react";
import type { TimelineBucket } from "../../utils/stats";

export function Timeline({ buckets }: { buckets: TimelineBucket[] }) {
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
