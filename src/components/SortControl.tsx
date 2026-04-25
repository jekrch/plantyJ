import { useState } from "react";
import type { SortMode } from "../utils/sorting";
import { SORT_OPTIONS, SORT_DESCRIPTIONS } from "../utils/sorting";
import { ChevronDown } from "lucide-react";

interface SortControlProps {
  activeSort: SortMode;
  onSort: (mode: SortMode) => void;
}

export default function SortControl({ activeSort, onSort }: SortControlProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sort-control panel-item overflow-hidden select-none">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          w-full flex items-center justify-end
          px-3 py-2.5
          transition-colors duration-150
          cursor-pointer
        "
      >
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[11px] tracking-wider text-ink/80 uppercase">
            {activeSort === "newest" || activeSort === "oldest"
              ? activeSort
              : `BY ${activeSort.toUpperCase()}`}
          </span>
          <ChevronDown
            size={14}
            className={`text-ink-faint transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease-out",
        }}
      >
        <div className="overflow-hidden">
          <div>
            {SORT_OPTIONS.map((opt) => {
              const isActive = opt.value === activeSort;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSort(opt.value);
                    setOpen(false);
                  }}
                  title={SORT_DESCRIPTIONS[opt.value]}
                  className={`
                    w-full text-right px-3 py-2
                    font-display text-[11px] tracking-wider uppercase
                    transition-colors duration-100
                    cursor-pointer
                    ${
                      isActive
                        ? "text-accent"
                        : "text-ink-muted hover:text-ink"
                    }
                  `}
                >
                  <span className="flex items-center justify-end gap-2">
                    {isActive && (
                      <span className="inline-block w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    )}
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
