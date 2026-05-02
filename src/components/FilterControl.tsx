import { useState, useMemo, useCallback } from "react";
import type { Annotation, Plant, Zone } from "../types";
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
  annotations: Annotation[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

export default function FilterControl({
  plants,
  zones,
  annotations,
  filters,
  onFiltersChange,
}: FilterControlProps) {
  const [open, setOpen] = useState(false);
  const [miscOpen, setMiscOpen] = useState(false);
  const active = hasActiveFilters(filters);
  const count = activeFilterCount(filters);

  const { tagItems, zoneItems, postedByItems, shortCodeItems } = useMemo(
    () => computeFacets(plants, filters, zones, annotations),
    [plants, filters, zones, annotations]
  );

  const toggleInSet = useCallback(
    (key: "tags" | "zoneCodes" | "postedBy" | "shortCodes" | "misc", value: string) => {
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

            <div className="border-t border-ink-faint/10">
              <button
                onClick={() => setMiscOpen((v) => !v)}
                className="
                  w-full flex items-center justify-between
                  px-3 py-2
                  text-left cursor-pointer
                  hover:bg-surface-hover transition-colors duration-100
                "
              >
                <span className="font-display text-[10px] tracking-widest text-accent uppercase">
                  OTHER
                </span>
                <span className="flex items-center gap-1.5">
                  {filters.misc.size > 0 && (
                    <span className="font-display text-[9px] text-accent tabular-nums">
                      {filters.misc.size}
                    </span>
                  )}
                  <ChevronDown
                    size={12}
                    className={`text-ink-faint transition-transform duration-200 ${
                      miscOpen ? "rotate-180" : ""
                    }`}
                  />
                </span>
              </button>
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: miscOpen ? "1fr" : "0fr",
                  transition: "grid-template-rows 200ms ease-out",
                }}
              >
                <div className="overflow-hidden">
                  <div className="px-1 pb-1.5">
                    {[
                      { value: "bioclip-conflict", label: "BIOCLIP CONFLICT" },
                      { value: "bioclip-match", label: "BIOCLIP MATCH" },
                      { value: "plant", label: "PLANT" },
                      { value: "animal", label: "ANIMAL" },
                      { value: "insect", label: "INSECT" },
                    ].map(({ value, label }) => {
                      const isActive = filters.misc.has(value);
                      return (
                        <button
                          key={value}
                          onClick={() => toggleInSet("misc", value)}
                          className={`
                            w-full text-left px-2 py-1 rounded-sm
                            flex items-center gap-1.5
                            transition-colors duration-100
                            cursor-pointer
                            ${
                              isActive
                                ? "text-accent bg-accent/8"
                                : "text-ink-muted hover:text-ink hover:bg-surface-hover"
                            }
                          `}
                        >
                          {isActive && (
                            <span className="inline-block w-1 h-1 rounded-full bg-accent shrink-0" />
                          )}
                          <span className="font-display text-[10px] tracking-wide uppercase">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
