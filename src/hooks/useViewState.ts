import { useCallback, useEffect, useRef, useState } from "react";
import type { AIVerdict } from "../types";
import type { Filters } from "../utils/filtering";
import { EMPTY_FILTERS } from "../utils/filtering";
import type { SortMode } from "../utils/sorting";
import type { ViewMode } from "../components/ViewModeControl";
import type { Tab as InfoTab } from "../components/InfoModal";
import { useFilterParams } from "./useFilterParams";

const INFO_TABS: InfoTab[] = ["about", "stats", "plants", "zones"];

/**
 * Owns all URL-driven view state: the active filters, sort mode, view mode,
 * spotlight/tree/web focus, and the info modal. Every mutation here keeps the
 * browser URL in sync. Cross-cutting actions that also touch the organism
 * viewer (e.g. selecting a taxon) expose a view-only primitive (`selectTaxon`)
 * that the caller composes with the viewer's reset.
 */
export function useViewState() {
  const {
    initialFilters,
    initialSort,
    initialView,
    initialSubject,
    initialTreeNode,
    initialWebNode,
    initialInfoTab,
    syncToURL,
    pushToURL,
  } = useFilterParams();

  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [spotlightCode, setSpotlightCode] = useState<string | null>(
    initialSubject
  );
  const [treeFocusNode, setTreeFocusNode] = useState<string | null>(
    initialTreeNode
  );
  // Captured once from the URL on load; WebView owns selection state thereafter
  // and reports changes back via onNodeSelect.
  const [webFocusNode] = useState<string | null>(initialWebNode);

  const isInfoTab = (t: string | null): t is InfoTab =>
    t != null && INFO_TABS.includes(t as InfoTab);
  const [infoOpen, setInfoOpen] = useState(() => isInfoTab(initialInfoTab));
  const [infoTab, setInfoTab] = useState<InfoTab>(
    isInfoTab(initialInfoTab) ? (initialInfoTab as InfoTab) : "about"
  );
  const pushedInfoStateRef = useRef(!isInfoTab(initialInfoTab));

  const handleOpenInfo = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("info", infoTab);
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}?${params}`
    );
    pushedInfoStateRef.current = true;
    setInfoOpen(true);
  }, [infoTab]);

  const handleCloseInfo = useCallback(() => {
    if (pushedInfoStateRef.current) {
      pushedInfoStateRef.current = false;
      window.history.back();
    } else {
      const params = new URLSearchParams(window.location.search);
      params.delete("info");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      );
      setInfoOpen(false);
    }
  }, []);

  const handleInfoTabChange = useCallback((tab: InfoTab) => {
    setInfoTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("info", tab);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params}`
    );
  }, []);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const infoParam = params.get("info");
      if (isInfoTab(infoParam)) {
        setInfoOpen(true);
        setInfoTab(infoParam as InfoTab);
        pushedInfoStateRef.current = true;
      } else {
        setInfoOpen(false);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const handleFiltersChange = useCallback(
    (next: Filters) => {
      setFilters(next);
      syncToURL(next, sortMode, viewMode, spotlightCode);
    },
    [sortMode, viewMode, spotlightCode, syncToURL]
  );

  const handleSortChange = useCallback(
    (next: SortMode) => {
      setSortMode(next);
      syncToURL(filters, next, viewMode, spotlightCode);
    },
    [filters, viewMode, spotlightCode, syncToURL]
  );

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  const handleViewModeChange = useCallback(
    (next: ViewMode, code: string | null) => {
      setViewMode(next);
      setSpotlightCode(code);
      syncToURL(filters, sortMode, next, code);
    },
    [filters, sortMode, syncToURL]
  );

  /**
   * View-only portion of "select a taxon": focuses the tree on the given node
   * and closes the info modal. The caller is responsible for resetting the
   * organism viewer (see App composition).
   */
  const selectTaxon = useCallback(
    (name: string) => {
      setTreeFocusNode(name);
      setViewMode("tree");
      setSpotlightCode(null);
      if (infoOpen) {
        pushToURL(filters, sortMode, "tree", null, name);
      } else {
        syncToURL(filters, sortMode, "tree", null, name);
      }
      setInfoOpen(false);
    },
    [filters, sortMode, syncToURL, pushToURL, infoOpen]
  );

  const handleShowBioclipConflicts = useCallback(() => {
    const next: Filters = {
      ...EMPTY_FILTERS,
      misc: new Set(["bioclip-conflict"]),
    };
    setFilters(next);
    setViewMode("gallery");
    setSpotlightCode(null);
    setTreeFocusNode(null);
    if (infoOpen) {
      pushToURL(next, sortMode, "gallery", null);
    } else {
      syncToURL(next, sortMode, "gallery", null);
    }
    setInfoOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sortMode, syncToURL, pushToURL, infoOpen]);

  const handleShowEcoFit = useCallback(
    (verdict: AIVerdict) => {
      const next: Filters = {
        ...EMPTY_FILTERS,
        aiVerdicts: new Set([verdict]),
      };
      setFilters(next);
      setViewMode("gallery");
      setSpotlightCode(null);
      setTreeFocusNode(null);
      if (infoOpen) {
        pushToURL(next, sortMode, "gallery", null);
      } else {
        syncToURL(next, sortMode, "gallery", null);
      }
      setInfoOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [sortMode, syncToURL, pushToURL, infoOpen]
  );

  const handleTreeNodeSelect = useCallback(
    (name: string | null) => {
      syncToURL(filters, sortMode, "tree", null, name);
    },
    [filters, sortMode, syncToURL]
  );

  const handleWebNodeSelect = useCallback(
    (code: string | null) => {
      syncToURL(filters, sortMode, "web", null, null, code);
    },
    [filters, sortMode, syncToURL]
  );

  const handleSpotlightOrganism = useCallback(
    (shortCode: string) => {
      setViewMode("plant");
      setSpotlightCode(shortCode);
      if (infoOpen) {
        pushToURL(filters, sortMode, "plant", shortCode);
      } else {
        syncToURL(filters, sortMode, "plant", shortCode);
      }
      setInfoOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [filters, sortMode, syncToURL, pushToURL, infoOpen]
  );

  const handleSpotlightZone = useCallback(
    (zoneCode: string) => {
      setViewMode("zone");
      setSpotlightCode(zoneCode);
      if (infoOpen) {
        pushToURL(filters, sortMode, "zone", zoneCode);
      } else {
        syncToURL(filters, sortMode, "zone", zoneCode);
      }
      setInfoOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [filters, sortMode, syncToURL, pushToURL, infoOpen]
  );

  return {
    // state
    sortMode,
    filters,
    viewMode,
    spotlightCode,
    treeFocusNode,
    webFocusNode,
    infoOpen,
    infoTab,
    // handlers
    handleFiltersChange,
    handleSortChange,
    clearFilters,
    handleOpenInfo,
    handleCloseInfo,
    handleInfoTabChange,
    handleViewModeChange,
    selectTaxon,
    handleShowBioclipConflicts,
    handleShowEcoFit,
    handleTreeNodeSelect,
    handleWebNodeSelect,
    handleSpotlightOrganism,
    handleSpotlightZone,
  };
}
