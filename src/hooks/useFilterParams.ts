import { useCallback, useMemo } from "react";
import type { Filters } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";

const FILTER_KEYS: (keyof Filters)[] = ["tags", "zoneCodes", "postedBy", "shortCodes"];
const DEFAULT_SORT: SortMode = "newest";

function parseFiltersFromURL(): { filters: Filters; sort: SortMode } {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    zoneCodes: new Set(params.get("zones")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
    shortCodes: new Set(params.get("plants")?.split(",").filter(Boolean) ?? []),
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  return { filters, sort };
}

const KEY_TO_PARAM: Record<keyof Filters, string> = {
  tags: "tags",
  zoneCodes: "zones",
  postedBy: "postedBy",
  shortCodes: "plants",
};

function buildParams(filters: Filters, sort: SortMode): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const values = Array.from(filters[key]);
    if (values.length > 0) params.set(KEY_TO_PARAM[key], values.join(","));
  }
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  return params.toString();
}

function pushURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const syncToURL = useCallback((filters: Filters, sort: SortMode) => {
    pushURL(buildParams(filters, sort));
  }, []);

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    syncToURL,
  };
}
