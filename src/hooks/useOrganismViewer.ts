import { useCallback, useMemo, useState } from "react";
import type { Organism } from "../types";

interface ViewerInputs {
  /** Every loaded organism, unfiltered. */
  organisms: Organism[];
  /** The current filtered + sorted gallery list. */
  sortedOrganisms: Organism[];
  /** Organisms backing the active plant/zone spotlight, if any. */
  spotlightOrganisms: Organism[];
}

export type ViewerScope = "filtered" | "all" | "spotlight" | "custom";

export interface ViewerLists {
  /** Explicit list passed when opening from an arbitrary surface. */
  custom: Organism[] | null;
  /** Organisms backing the active plant/zone spotlight. */
  spotlight: Organism[];
  /** Every loaded organism, unfiltered. */
  all: Organism[];
  /** The current filtered + sorted gallery list. */
  sorted: Organism[];
}

/**
 * Picks which list backs the viewer's prev/next paging for a given scope.
 * Precedence mirrors how the viewer was opened: an explicit custom list wins,
 * then a non-empty spotlight, then the full set, otherwise the gallery list.
 */
export function resolveViewerOrganisms(
  scope: ViewerScope,
  lists: ViewerLists
): Organism[] {
  if (scope === "custom" && lists.custom) return lists.custom;
  if (scope === "spotlight" && lists.spotlight.length > 0)
    return lists.spotlight;
  if (scope === "all") return lists.all;
  return lists.sorted;
}

/**
 * Owns the full-screen organism viewer: which organism is open, the list it
 * pages through (scope), and navigation within that list. The scope decides
 * which input list backs prev/next so the viewer stays consistent with the
 * surface the user opened it from.
 */
export function useOrganismViewer({
  organisms,
  sortedOrganisms,
  spotlightOrganisms,
}: ViewerInputs) {
  const [openOrganismId, setOpenOrganismId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("plant")
  );
  const [viewerScope, setViewerScope] = useState<ViewerScope>("filtered");
  const [customViewerOrganisms, setCustomViewerOrganisms] = useState<
    Organism[] | null
  >(null);

  const viewerOrganisms = resolveViewerOrganisms(viewerScope, {
    custom: customViewerOrganisms,
    spotlight: spotlightOrganisms,
    all: organisms,
    sorted: sortedOrganisms,
  });

  const openIndex = useMemo(() => {
    if (!openOrganismId) return -1;
    return viewerOrganisms.findIndex((p) => p.id === openOrganismId);
  }, [openOrganismId, viewerOrganisms]);

  const openOrganism = useCallback((organism: Organism) => {
    setViewerScope("filtered");
    setOpenOrganismId(organism.id);
  }, []);

  const openFromSpotlight = useCallback((organism: Organism) => {
    setViewerScope("spotlight");
    setOpenOrganismId(organism.id);
  }, []);

  const openInList = useCallback((organism: Organism, list: Organism[]) => {
    setCustomViewerOrganisms(list);
    setViewerScope("custom");
    setOpenOrganismId(organism.id);
  }, []);

  const closeViewer = useCallback(() => {
    setOpenOrganismId(null);
    setViewerScope("filtered");
    setCustomViewerOrganisms(null);
  }, []);

  const selectOrganism = useCallback(
    (organism: Organism) => {
      const inFiltered = sortedOrganisms.some((p) => p.id === organism.id);
      setViewerScope(inFiltered ? "filtered" : "all");
      setOpenOrganismId(organism.id);
    },
    [sortedOrganisms]
  );

  const navigateViewer = useCallback(
    (idx: number) => {
      const target = viewerOrganisms[idx];
      if (target) setOpenOrganismId(target.id);
    },
    [viewerOrganisms]
  );

  return {
    openOrganismId,
    viewerOrganisms,
    openIndex,
    openOrganism,
    openFromSpotlight,
    openInList,
    closeViewer,
    selectOrganism,
    navigateViewer,
    /** Reset to the default scope with nothing open. */
    resetViewer: closeViewer,
  };
}
