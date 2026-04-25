import { useState, useMemo, useCallback } from "react";
import type { Plant, Zone } from "../types";
import type { Filters } from "../utils/filtering";
import {
  hasActiveFilters,
  activeFilterCount,
  computeFacets,
  EMPTY_FILTERS,
} from "../utils/filtering";
import FacetSection from "./FacetSection";
import { ChevronDown, XCircle } from "lucide-react";

interface FilterControlProps {
  plants: Plant[];
  zones: Zone[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function FilterControl({
  plants,
  zones,
  filters,
  onFiltersChange,
}: FilterControlProps) {
  const [open, setOpen] = useState(false);
  const active = hasActiveFilters(filters);
  const count = activeFilterCount(filters);

  const { tagItems, zoneItems, postedByItems, shortCodeItems } = useMemo(
    () => computeFacets(plants, filters, zones),
    [plants, filters, zones]
  );

  const toggleInSet = useCallback(
    (key: keyof Filters, value: string) => {
      const next = new Set(filters[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      onFiltersChange({ ...filters, [key]: next });
    },
    [filters, onFiltersChange]
  );

  const clearAll = useCallback(() => {
    onFiltersChange(EMPTY_FILTERS);
  }, [onFiltersChange]);

  return (
    <div className="filter-control panel-item overflow-hidden select-none">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="
          w-full flex items-center
          px-3 py-2.5
          transition-colors duration-150
          cursor-pointer
        "
      >
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[11px] tracking-wider text-ink/80 uppercase">
            FILTER
          </span>
          {active && (
            <span className="font-display text-[9px] text-surface bg-accent rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
              {count}
            </span>
          )}
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
            {active && (
              <div className="px-3 py-2">
                <button
                  onClick={() => {
                    clearAll();
                    setOpen(false);
                  }}
                  className="
                    flex items-center gap-1.5
                    font-display text-[10px] tracking-wider uppercase
                    text-ink-muted hover:text-accent
                    transition-colors duration-100
                    cursor-pointer
                  "
                >
                  <XCircle size={12} className="text-accent" />
                  CLEAR {count} {count === 1 ? "FILTER" : "FILTERS"}
                </button>
              </div>
            )}

            <FacetSection
              title="PLANT"
              items={shortCodeItems}
              selected={filters.shortCodes}
              onToggle={(v) => toggleInSet("shortCodes", v)}
            />
            <FacetSection
              title="ZONE"
              items={zoneItems}
              selected={filters.zoneCodes}
              onToggle={(v) => toggleInSet("zoneCodes", v)}
            />
            <FacetSection
              title="TAGS"
              items={tagItems}
              selected={filters.tags}
              onToggle={(v) => toggleInSet("tags", v)}
            />
            <FacetSection
              title="POSTED BY"
              items={postedByItems}
              selected={filters.postedBy}
              onToggle={(v) => toggleInSet("postedBy", v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
