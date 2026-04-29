import { useEffect, useState, useMemo, useCallback } from "react";
import type { Annotation, PicRecord, Plant, PlantRecord, Species, Zone, ZonePic } from "./types";
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
import SpotlightView from "./components/SpotlightView";
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const {
    initialFilters,
    initialSort,
    initialView,
    initialSubject,
    syncToURL,
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
  const [viewerScope, setViewerScope] = useState<"filtered" | "all" | "spotlight">("filtered");
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [spotlightCode, setSpotlightCode] = useState<string | null>(initialSubject);

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
    ])
      .then(([picsData, plantsData, zonesData, zonePicsData, annotationsData]) => {
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
    () => applyFilters(plants, filters, annotations),
    [plants, filters, annotations]
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

  const handleCloseViewer = useCallback(() => {
    setOpenPlantId(null);
    setViewerScope("filtered");
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

  const handleApplyShortCodes = useCallback(
    (shortCodes: string[]) => {
      const next: Filters = { ...filters, shortCodes: new Set(shortCodes) };
      setFilters(next);
      syncToURL(next, sortMode, viewMode, spotlightCode);
      setOpenPlantId(null);
      setViewerScope("filtered");
    },
    [filters, sortMode, viewMode, spotlightCode, syncToURL]
  );

  const handleSpotlightPlant = useCallback(
    (shortCode: string) => {
      setViewMode("plant");
      setSpotlightCode(shortCode);
      syncToURL(filters, sortMode, "plant", shortCode);
      setInfoOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [filters, sortMode, syncToURL]
  );

  const handleSpotlightZone = useCallback(
    (zoneCode: string) => {
      setViewMode("zone");
      setSpotlightCode(zoneCode);
      syncToURL(filters, sortMode, "zone", zoneCode);
      setInfoOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [filters, sortMode, syncToURL]
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
    viewerScope === "spotlight" && spotlightPlants.length > 0
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
      <BackgroundEchoes plantPositions={plantPositions} />
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-sm border-b border-ink-faint/30 pl-1!">
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
            onClick={() => setInfoOpen(true)}
            className="flex items-center justify-center h-8 w-8 mr-2 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="About this site"
            aria-label="About this site"
          >
            <House color={"#b08968"} size={20} strokeWidth={1.5} />
          </button>
        </div>
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

            {viewMode !== "gallery" && spotlightCode && (
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

      <InfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        plants={plants}
        plantRecords={plantRecords}
        zones={zones}
        zonePics={zonePics}
        onSpotlightPlant={handleSpotlightPlant}
        onSpotlightZone={handleSpotlightZone}
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
          onApplyShortCodes={handleApplyShortCodes}
        />
      )}
    </div>
  );
}
