import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { Annotation, PicRecord, Plant, PlantRecord, Species, TaxaInfo, Zone, ZonePic } from "./types";
import { Sprout, House } from "lucide-react";
import { sortPlantsAsync } from "./utils/sorting.ts";
import type { SortMode } from "./utils/sorting.ts";
import type { Filters } from "./utils/filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./utils/filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import BackgroundEchoes from "./components/BackgroundEchoes";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
import { useFilterParams } from "./hooks/useFilterParams";
import PlantViewer from "./components/PlantViewer";
import InfoModal from "./components/InfoModal";
import type { Tab as InfoTab } from "./components/InfoModal";
import SpotlightView from "./components/SpotlightView";
import TreeView from "./components/TreeView";
import ViewModeControl from "./components/ViewModeControl";
import type { ViewMode } from "./components/ViewModeControl";

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function App() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantRecords, setPlantRecords] = useState<PlantRecord[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonePics, setZonePics] = useState<ZonePic[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [speciesByShortCode, setSpeciesByShortCode] = useState<
    Map<string, Species>
  >(new Map());
  const [taxa, setTaxa] = useState<Record<string, TaxaInfo>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const {
    initialFilters,
    initialSort,
    initialView,
    initialSubject,
    initialTreeNode,
    initialInfoTab,
    syncToURL,
    pushToURL,
  } = useFilterParams();
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sortedPlants, setSortedPlants] = useState<Plant[]>([]);
  const [plantPositions, setPlantPositions] = useState<
    { plant: Plant; y: number; h: number }[]
  >([]);
  const [openPlantId, setOpenPlantId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("plant")
  );
  const [viewerScope, setViewerScope] = useState<
    "filtered" | "all" | "spotlight" | "custom"
  >("filtered");
  const [customViewerPlants, setCustomViewerPlants] = useState<Plant[] | null>(
    null
  );
  const INFO_TABS: InfoTab[] = ["about", "stats", "plants", "zones"];
  const [infoOpen, setInfoOpen] = useState(() => INFO_TABS.includes(initialInfoTab as InfoTab));
  const [infoTab, setInfoTab] = useState<InfoTab>(
    INFO_TABS.includes(initialInfoTab as InfoTab) ? (initialInfoTab as InfoTab) : "about"
  );
  const pushedInfoStateRef = useRef(!INFO_TABS.includes(initialInfoTab as InfoTab));
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [spotlightCode, setSpotlightCode] = useState<string | null>(initialSubject);
  const [treeFocusNode, setTreeFocusNode] = useState<string | null>(initialTreeNode);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleOpenInfo = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("info", infoTab);
    window.history.pushState(null, "", `${window.location.pathname}?${params}`);
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
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
      setInfoOpen(false);
    }
  }, []);

  const handleInfoTabChange = useCallback((tab: InfoTab) => {
    setInfoTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("info", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, []);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const infoParam = params.get("info");
      if (infoParam && INFO_TABS.includes(infoParam as InfoTab)) {
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

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const fetchJson = <T,>(path: string) =>
      fetch(`${base}${path}`).then((res) => {
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return res.json() as Promise<T>;
      });

    Promise.all([
      fetchJson<{ pics?: PicRecord[] }>("data/pics.json"),
      fetchJson<{ plants?: PlantRecord[] }>("data/plants.json"),
      fetchJson<{ zones?: Zone[] }>("data/zones.json"),
      fetchJson<{ zonePics?: ZonePic[] }>("data/zone_pics.json").catch(
        () => ({ zonePics: [] as ZonePic[] })
      ),
      fetchJson<{ annotations?: Annotation[] }>("data/annotations.json").catch(
        () => ({ annotations: [] as Annotation[] })
      ),
      fetchJson<Record<string, TaxaInfo>>("data/taxa.json").catch(
        () => ({} as Record<string, TaxaInfo>)
      ),
    ])
      .then(([picsData, plantsData, zonesData, zonePicsData, annotationsData, taxaData]) => {
        const plantsByCode = new Map<string, PlantRecord>();
        for (const p of plantsData.plants ?? []) plantsByCode.set(p.shortCode, p);

        const merged: Plant[] = (picsData.pics ?? []).map((pic) => {
          const plant = plantsByCode.get(pic.shortCode);
          return {
            ...pic,
            fullName: plant?.fullName ?? null,
            commonName: plant?.commonName ?? null,
            variety: plant?.variety ?? null,
          };
        });

        setPlants(merged);
        setPlantRecords(plantsData.plants ?? []);
        setZones(zonesData.zones ?? []);
        setZonePics(zonePicsData.zonePics ?? []);
        setAnnotations(annotationsData.annotations ?? []);
        setTaxa(taxaData ?? {});
        setStatus("ready");

        // Load species data in parallel — non-blocking; fills in once available.
        const records = plantsData.plants ?? [];
        Promise.all(
          records.map(async (p) => {
            if (!p.fullName) return null;
            const slug = slugifyName(p.fullName);
            try {
              const res = await fetch(`${base}data/species/${slug}.json`);
              if (!res.ok) return null;
              const sp = (await res.json()) as Species;
              return [p.shortCode, sp] as const;
            } catch {
              return null;
            }
          })
        ).then((entries) => {
          const m = new Map<string, Species>();
          for (const e of entries) if (e) m.set(e[0], e[1]);
          setSpeciesByShortCode(m);
        });
      })
      .catch(() => setStatus("error"));
  }, []);

  const filteredPlants = useMemo(
    () => applyFilters(plants, filters, annotations, speciesByShortCode),
    [plants, filters, annotations, speciesByShortCode]
  );

  useEffect(() => {
    let cancelled = false;
    sortPlantsAsync(filteredPlants, sortMode).then((result) => {
      if (!cancelled) setSortedPlants(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filteredPlants, sortMode]);

  const handleLayoutReady = useCallback(() => {
    setImagesLoaded(true);
  }, []);

  const handleOpenPlant = useCallback((plant: Plant) => {
    setViewerScope("filtered");
    setOpenPlantId(plant.id);
  }, []);

  const handleOpenFromSpotlight = useCallback((plant: Plant) => {
    setViewerScope("spotlight");
    setOpenPlantId(plant.id);
  }, []);

  const handleOpenInList = useCallback((plant: Plant, list: Plant[]) => {
    setCustomViewerPlants(list);
    setViewerScope("custom");
    setOpenPlantId(plant.id);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setOpenPlantId(null);
    setViewerScope("filtered");
    setCustomViewerPlants(null);
  }, []);

  const handleViewModeChange = useCallback(
    (next: ViewMode, code: string | null) => {
      setViewMode(next);
      setSpotlightCode(code);
      syncToURL(filters, sortMode, next, code);
    },
    [filters, sortMode, syncToURL]
  );

  const handleSelectPlant = useCallback(
    (plant: Plant) => {
      const inFiltered = sortedPlants.some((p) => p.id === plant.id);
      setViewerScope(inFiltered ? "filtered" : "all");
      setOpenPlantId(plant.id);
    },
    [sortedPlants]
  );

  const handleSelectTaxon = useCallback(
    (name: string) => {
      setTreeFocusNode(name);
      setViewMode("tree");
      setSpotlightCode(null);
      if (infoOpen) {
        pushToURL(filters, sortMode, "tree", null, name);
      } else {
        syncToURL(filters, sortMode, "tree", null, name);
      }
      setOpenPlantId(null);
      setViewerScope("filtered");
      setCustomViewerPlants(null);
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

  const handleTreeNodeSelect = useCallback(
    (name: string | null) => {
      syncToURL(filters, sortMode, "tree", null, name);
    },
    [filters, sortMode, syncToURL]
  );

  const handleSpotlightPlant = useCallback(
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

  const spotlightPlants = useMemo(() => {
    if (viewMode === "gallery" || !spotlightCode) return [];
    const list =
      viewMode === "plant"
        ? plants.filter((p) => p.shortCode === spotlightCode)
        : plants.filter((p) => p.zoneCode === spotlightCode);
    return [...list].sort(
      (a, b) =>
        new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
  }, [plants, viewMode, spotlightCode]);

  const viewerPlants =
    viewerScope === "custom" && customViewerPlants
      ? customViewerPlants
      : viewerScope === "spotlight" && spotlightPlants.length > 0
      ? spotlightPlants
      : viewerScope === "all"
      ? plants
      : sortedPlants;

  const handleNavigateViewer = useCallback(
    (idx: number) => {
      const target = viewerPlants[idx];
      if (target) setOpenPlantId(target.id);
    },
    [viewerPlants]
  );

  const openIndex = useMemo(() => {
    if (!openPlantId) return -1;
    return viewerPlants.findIndex((p) => p.id === openPlantId);
  }, [openPlantId, viewerPlants]);

  return (
    <div className="min-h-screen bg-surface relative">
      {viewMode === "gallery" && (
        <BackgroundEchoes plantPositions={plantPositions} />
      )}
      <header ref={headerRef} className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-ink-faint/30">
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <div className="flex items-center gap-2 px-2 py-2">
            <Sprout
              size={22}
              strokeWidth={1.5}
              className="stroke-accent"
            />
            <h1
              className="font-display font-bold text-xl tracking-tight text-ink cursor-pointer"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              PlantyJ
            </h1>
          </div>
          <button
            onClick={handleOpenInfo}
            className="flex items-center justify-center h-8 w-8 mr-2 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="About this site"
            aria-label="About this site"
          >
            <House color={"#b08968"} size={20} strokeWidth={1.5} />
          </button>
        </div>
        {status === "ready" && plants.length > 0 && viewMode === "tree" && (
          <div className="content-container px-1 pt-2 pb-3 border-t border-ink-faint/20">
            <ViewModeControl
              mode={viewMode}
              subjectCode={spotlightCode}
              plants={plants}
              plantRecords={plantRecords}
              zones={zones}
              onChange={handleViewModeChange}
            />
          </div>
        )}
      </header>

      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {(status === "loading" ||
          (status === "ready" &&
            plants.length > 0 &&
            viewMode === "gallery" &&
            !imagesLoaded)) && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && plants.length === 0 && <EmptyState />}
        {status === "ready" && plants.length > 0 && (
          <div
            className="transition-opacity duration-700 ease-out"
            style={{ opacity: viewMode !== "gallery" || imagesLoaded ? 1 : 0 }}
          >
            {viewMode !== "tree" && (
              <div className="pt-2 pb-3">
                <ViewModeControl
                  mode={viewMode}
                  subjectCode={spotlightCode}
                  plants={plants}
                  plantRecords={plantRecords}
                  zones={zones}
                  onChange={handleViewModeChange}
                />
              </div>
            )}

            {viewMode === "gallery" && (
              <>
                <MasonryGrid
                  plants={sortedPlants}
                  allPlants={plants}
                  zones={zones}
                  annotations={annotations}
                  sortMode={sortMode}
                  onSort={handleSortChange}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onLayoutReady={handleLayoutReady}
                  onPlantPositions={setPlantPositions}
                  onOpenPlant={handleOpenPlant}
                />
                {hasActiveFilters(filters) && sortedPlants.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <p className="text-ink-muted text-sm font-display tracking-wide">
                      NO MATCHES
                    </p>
                    <button
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors font-display tracking-wider uppercase cursor-pointer"
                    >
                      CLEAR FILTERS
                    </button>
                  </div>
                )}
              </>
            )}

            {(viewMode === "plant" || viewMode === "zone") && spotlightCode && (
              <SpotlightView
                kind={viewMode}
                subjectCode={spotlightCode}
                allPlants={plants}
                zonePics={zonePics}
                zones={zones}
                onOpenViewer={handleOpenFromSpotlight}
              />
            )}

          </div>
        )}
      </main>

      {status === "ready" && plants.length > 0 && viewMode === "tree" && (
        <TreeView
          plants={plants}
          speciesByShortCode={speciesByShortCode}
          taxa={taxa}
          headerHeight={headerHeight}
          onOpenPlantInList={handleOpenInList}
          onSpotlightPlant={handleSpotlightPlant}
          initialTreeNode={treeFocusNode}
          onNodeSelect={handleTreeNodeSelect}
        />
      )}

      <InfoModal
        open={infoOpen}
        onClose={handleCloseInfo}
        activeTab={infoTab}
        onTabChange={handleInfoTabChange}
        plants={plants}
        plantRecords={plantRecords}
        zones={zones}
        zonePics={zonePics}
        speciesByShortCode={speciesByShortCode}
        onSpotlightPlant={handleSpotlightPlant}
        onSpotlightZone={handleSpotlightZone}
        onSelectTaxon={handleSelectTaxon}
        onShowBioclipConflicts={handleShowBioclipConflicts}
      />

      {openIndex >= 0 && (
        <PlantViewer
          plant={viewerPlants[openIndex]}
          plants={viewerPlants}
          allPlants={plants}
          zones={zones}
          zonePics={zonePics}
          annotations={annotations}
          speciesByShortCode={speciesByShortCode}
          currentIndex={openIndex}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateViewer}
          onSelectPlant={handleSelectPlant}
          onSelectTaxon={handleSelectTaxon}
        />
      )}
    </div>
  );
}
