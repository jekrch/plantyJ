import { useCallback, useMemo } from "react";
import type { Filters } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { ViewMode } from "../components/ViewModeControl";

const FILTER_KEYS: (keyof Filters)[] = ["tags", "zoneCodes", "postedBy", "shortCodes"];
const DEFAULT_SORT: SortMode = "newest";
const DEFAULT_VIEW: ViewMode = "gallery";

interface InitialState {
  filters: Filters;
  sort: SortMode;
  view: ViewMode;
  subject: string | null;
}

function parseFiltersFromURL(): InitialState {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    zoneCodes: new Set(params.get("zones")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
    shortCodes: new Set(params.get("plants")?.split(",").filter(Boolean) ?? []),
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "plant" || rawView === "zone" || rawView === "tree"
      ? rawView
      : DEFAULT_VIEW;
  const subject =
    view === "plant" || view === "zone" ? params.get("subject") : null;

  return { filters, sort, view, subject };
}

const KEY_TO_PARAM: Record<keyof Filters, string> = {
  tags: "tags",
  zoneCodes: "zones",
  postedBy: "postedBy",
  shortCodes: "plants",
};

function buildParams(
  filters: Filters,
  sort: SortMode,
  view: ViewMode,
  subject: string | null
): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const values = Array.from(filters[key]);
    if (values.length > 0) params.set(KEY_TO_PARAM[key], values.join(","));
  }
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  if (view !== DEFAULT_VIEW) {
    params.set("view", view);
    if (subject && (view === "plant" || view === "zone")) {
      params.set("subject", subject);
    }
  }
  return params.toString();
}

function pushURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const syncToURL = useCallback(
    (filters: Filters, sort: SortMode, view: ViewMode, subject: string | null) => {
      pushURL(buildParams(filters, sort, view, subject));
    },
    []
  );

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    initialView: initial.view,
    initialSubject: initial.subject,
    syncToURL,
  };
}
