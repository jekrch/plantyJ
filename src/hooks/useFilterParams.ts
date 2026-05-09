import { useCallback, useMemo } from "react";
import type { Filters } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { ViewMode } from "../components/ViewModeControl";

const SET_FILTER_KEYS = ["tags", "zoneCodes", "postedBy", "shortCodes", "misc", "aiVerdicts"] as const;
type SetFilterKey = typeof SET_FILTER_KEYS[number];
const DEFAULT_SORT: SortMode = "newest";
const DEFAULT_VIEW: ViewMode = "gallery";

interface InitialState {
  filters: Filters;
  sort: SortMode;
  view: ViewMode;
  subject: string | null;
  treeNode: string | null;
  infoTab: string | null;
}

function parseFiltersFromURL(): InitialState {
  const params = new URLSearchParams(window.location.search);

  const filters: Filters = {
    tags: new Set(params.get("tags")?.split(",").filter(Boolean) ?? []),
    zoneCodes: new Set(params.get("zones")?.split(",").filter(Boolean) ?? []),
    postedBy: new Set(params.get("postedBy")?.split(",").filter(Boolean) ?? []),
    shortCodes: new Set(params.get("plants")?.split(",").filter(Boolean) ?? []),
    misc: new Set(params.get("misc")?.split(",").filter(Boolean) ?? []),
    aiVerdicts: new Set(params.get("ecoFit")?.split(",").filter(Boolean) ?? []),
    searchQuery: params.get("q") ?? "",
  };

  const sort = (params.get("sort") as SortMode) ?? DEFAULT_SORT;

  const rawView = params.get("view");
  const view: ViewMode =
    rawView === "plant" || rawView === "zone" || rawView === "tree"
      ? rawView
      : DEFAULT_VIEW;
  const subject =
    view === "plant" || view === "zone" ? params.get("subject") : null;
  const treeNode = view === "tree" ? params.get("treeNode") : null;
  const infoTab = params.get("info");

  return { filters, sort, view, subject, treeNode, infoTab };
}

const KEY_TO_PARAM: Record<SetFilterKey, string> = {
  tags: "tags",
  zoneCodes: "zones",
  postedBy: "postedBy",
  shortCodes: "plants",
  misc: "misc",
  aiVerdicts: "ecoFit",
};

export function buildParams(
  filters: Filters,
  sort: SortMode,
  view: ViewMode,
  subject: string | null,
  treeNode: string | null = null
): string {
  const params = new URLSearchParams();
  for (const key of SET_FILTER_KEYS) {
    const values = Array.from(filters[key]);
    if (values.length > 0) params.set(KEY_TO_PARAM[key], values.join(","));
  }
  if (filters.searchQuery.trim()) params.set("q", filters.searchQuery);
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  if (view !== DEFAULT_VIEW) {
    params.set("view", view);
    if (subject && (view === "plant" || view === "zone")) {
      params.set("subject", subject);
    }
    if (treeNode && view === "tree") {
      params.set("treeNode", treeNode);
    }
  }
  return params.toString();
}

function replaceURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function pushURL(qs: string) {
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.pushState(null, "", url);
}

export function useFilterParams() {
  const initial = useMemo(() => parseFiltersFromURL(), []);

  const syncToURL = useCallback(
    (filters: Filters, sort: SortMode, view: ViewMode, subject: string | null, treeNode: string | null = null) => {
      replaceURL(buildParams(filters, sort, view, subject, treeNode));
    },
    []
  );

  const pushToURL = useCallback(
    (filters: Filters, sort: SortMode, view: ViewMode, subject: string | null, treeNode: string | null = null) => {
      pushURL(buildParams(filters, sort, view, subject, treeNode));
    },
    []
  );

  return {
    initialFilters: initial.filters,
    initialSort: initial.sort,
    initialView: initial.view,
    initialSubject: initial.subject,
    initialTreeNode: initial.treeNode,
    initialInfoTab: initial.infoTab,
    syncToURL,
    pushToURL,
  };
}
