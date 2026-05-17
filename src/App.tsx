import {
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import type { AIAnalysis, AIVerdict, Annotation, PicRecord, Organism, OrganismRecord, Species, TaxaInfo, Zone, ZonePic } from "./types";
import { Sprout, House } from "lucide-react";
import { sortOrganismsAsync } from "./utils/sorting.ts";
import type { SortMode } from "./utils/sorting.ts";
import type { Filters } from "./utils/filtering.ts";
import { applyFilters, hasActiveFilters, EMPTY_FILTERS } from "./utils/filtering.ts";
import MasonryGrid from "./components/MasonryGrid";
import BackgroundEchoes from "./components/BackgroundEchoes";
import { SpinnerState, ErrorState, EmptyState } from "./components/StatusStates";
import { useFilterParams } from "./hooks/useFilterParams";
import { useRelationships } from "./hooks/useRelationships";
import OrganismViewer from "./components/OrganismViewer";
import InfoModal from "./components/InfoModal";
import type { Tab as InfoTab } from "./components/InfoModal";
import SpotlightView from "./components/SpotlightView";
import TreeView from "./components/TreeView";
import WebView from "./components/WebView";
import ViewModeControl from "./components/ViewModeControl";
import type { ViewMode } from "./components/ViewModeControl";

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function App() {
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [organismRecords, setOrganismRecords] = useState<OrganismRecord[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonePics, setZonePics] = useState<ZonePic[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [speciesByShortCode, setSpeciesByShortCode] = useState<
    Map<string, Species>
  >(new Map());
  const [speciesLoaded, setSpeciesLoaded] = useState(false);
  const [taxa, setTaxa] = useState<Record<string, TaxaInfo>>({});
  const [aiAnalyses, setAiAnalyses] = useState<AIAnalysis[]>([]);
  const relationshipsData = useRelationships();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imagesLoaded, setImagesLoaded] = useState(false);
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
  const [sortedOrganisms, setSortedOrganisms] = useState<Organism[]>([]);
  const [organismPositions, setOrganismPositions] = useState<
    { organism: Organism; y: number; h: number }[]
  >([]);
  const [openOrganismId, setOpenOrganismId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("plant")
  );
  const [viewerScope, setViewerScope] = useState<
    "filtered" | "all" | "spotlight" | "custom"
  >("filtered");
  const [customViewerOrganisms, setCustomViewerOrganisms] = useState<Organism[] | null>(
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
  // Captured once from the URL on load; WebView owns selection state thereafter
  // and reports changes back via onNodeSelect.
  const [webFocusNode] = useState<string | null>(initialWebNode);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure synchronously when the header's content swaps (e.g. ViewModeControl
  // moves into the header in tree mode), so TreeView mounts with the correct top
  // offset instead of catching up via the ResizeObserver after paint.
  useLayoutEffect(() => {
    if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
  }, [viewMode, status]);

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
      fetchJson<{ plants?: OrganismRecord[] }>("data/plants.json"),
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
      .then(([picsData, organismsData, zonesData, zonePicsData, annotationsData, taxaData]) => {
        const organismsByCode = new Map<string, OrganismRecord>();
        for (const p of organismsData.plants ?? []) organismsByCode.set(p.shortCode, p);

        const merged: Organism[] = (picsData.pics ?? []).map((pic) => {
          const organism = organismsByCode.get(pic.shortCode);
          return {
            ...pic,
            fullName: organism?.fullName ?? null,
            commonName: organism?.commonName ?? null,
            variety: organism?.variety ?? null,
          };
        });

        setOrganisms(merged);
        setOrganismRecords(organismsData.plants ?? []);
        setZones(zonesData.zones ?? []);
        setZonePics(zonePicsData.zonePics ?? []);
        setAnnotations(annotationsData.annotations ?? []);
        setTaxa(taxaData ?? {});
        setStatus("ready");

        // Load combined species bundle — non-blocking; fills in once available.
        const records = organismsData.plants ?? [];
        fetchJson<{ species?: Record<string, Species> }>("data/species.json")
          .then((bundle) => {
            const bySlug = bundle.species ?? {};
            const m = new Map<string, Species>();
            for (const p of records) {
              if (!p.fullName) continue;
              const sp = bySlug[slugifyName(p.fullName)];
              if (sp) m.set(p.shortCode, sp);
            }
            setSpeciesByShortCode(m);
          })
          .catch(() => {
            setSpeciesByShortCode(new Map());
          })
          .finally(() => {
            setSpeciesLoaded(true);
          });
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/ai_analysis.json`)
      .then((res) => res.json())
      .then((data) => setAiAnalyses(data.analyses ?? []))
      .catch(() => setAiAnalyses([]));
  }, []);

  const filteredOrganisms = useMemo(
    () => applyFilters(organisms, filters, annotations, speciesByShortCode, aiAnalyses),
    [organisms, filters, annotations, speciesByShortCode, aiAnalyses]
  );

  useEffect(() => {
    let cancelled = false;
    sortOrganismsAsync(filteredOrganisms, sortMode).then((result) => {
      if (!cancelled) setSortedOrganisms(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filteredOrganisms, sortMode]);

  const handleLayoutReady = useCallback(() => {
    setImagesLoaded(true);
  }, []);

  const handleOpenOrganism = useCallback((organism: Organism) => {
    setViewerScope("filtered");
    setOpenOrganismId(organism.id);
  }, []);

  const handleOpenFromSpotlight = useCallback((organism: Organism) => {
    setViewerScope("spotlight");
    setOpenOrganismId(organism.id);
  }, []);

  const handleOpenInList = useCallback((organism: Organism, list: Organism[]) => {
    setCustomViewerOrganisms(list);
    setViewerScope("custom");
    setOpenOrganismId(organism.id);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setOpenOrganismId(null);
    setViewerScope("filtered");
    setCustomViewerOrganisms(null);
  }, []);

  const handleViewModeChange = useCallback(
    (next: ViewMode, code: string | null) => {
      setViewMode(next);
      setSpotlightCode(code);
      syncToURL(filters, sortMode, next, code);
    },
    [filters, sortMode, syncToURL]
  );

  const handleSelectOrganism = useCallback(
    (organism: Organism) => {
      const inFiltered = sortedOrganisms.some((p) => p.id === organism.id);
      setViewerScope(inFiltered ? "filtered" : "all");
      setOpenOrganismId(organism.id);
    },
    [sortedOrganisms]
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
      setOpenOrganismId(null);
      setViewerScope("filtered");
      setCustomViewerOrganisms(null);
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

  const spotlightOrganisms = useMemo(() => {
    if (viewMode === "gallery" || !spotlightCode) return [];
    const list =
      viewMode === "plant"
        ? organisms.filter((p) => p.shortCode === spotlightCode)
        : organisms.filter((p) => p.zoneCode === spotlightCode);
    return [...list].sort(
      (a, b) =>
        new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
  }, [organisms, viewMode, spotlightCode]);

  const viewerOrganisms =
    viewerScope === "custom" && customViewerOrganisms
      ? customViewerOrganisms
      : viewerScope === "spotlight" && spotlightOrganisms.length > 0
      ? spotlightOrganisms
      : viewerScope === "all"
      ? organisms
      : sortedOrganisms;

  const handleNavigateViewer = useCallback(
    (idx: number) => {
      const target = viewerOrganisms[idx];
      if (target) setOpenOrganismId(target.id);
    },
    [viewerOrganisms]
  );

  const openIndex = useMemo(() => {
    if (!openOrganismId) return -1;
    return viewerOrganisms.findIndex((p) => p.id === openOrganismId);
  }, [openOrganismId, viewerOrganisms]);

  return (
    <div className="min-h-screen bg-surface relative">
      {viewMode === "gallery" && (
        <BackgroundEchoes organismPositions={organismPositions} />
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
        {status === "ready" && organisms.length > 0 && (viewMode === "tree" || viewMode === "web") && (
          <div className="content-container px-1 pt-2 pb-3 border-t border-ink-faint/20">
            <ViewModeControl
              mode={viewMode}
              subjectCode={spotlightCode}
              organisms={organisms}
              organismRecords={organismRecords}
              zones={zones}
              onChange={handleViewModeChange}
            />
          </div>
        )}
      </header>

      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {status === "ready" && organisms.length > 0 && viewMode !== "tree" && viewMode !== "web" && (
          <div className="pt-2 pb-3">
            <ViewModeControl
              mode={viewMode}
              subjectCode={spotlightCode}
              organisms={organisms}
              organismRecords={organismRecords}
              zones={zones}
              onChange={handleViewModeChange}
            />
          </div>
        )}
        {(status === "loading" ||
          (status === "ready" &&
            organisms.length > 0 &&
            viewMode === "gallery" &&
            !imagesLoaded)) && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "ready" && organisms.length === 0 && <EmptyState />}
        {status === "ready" && organisms.length > 0 && (
          <div
            className="transition-opacity duration-700 ease-out"
            style={{ opacity: viewMode !== "gallery" || imagesLoaded ? 1 : 0 }}
          >
            {viewMode === "gallery" && (
              <>
                <MasonryGrid
                  organisms={sortedOrganisms}
                  allOrganisms={organisms}
                  zones={zones}
                  annotations={annotations}
                  aiAnalyses={aiAnalyses}
                  sortMode={sortMode}
                  onSort={handleSortChange}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onLayoutReady={handleLayoutReady}
                  onOrganismPositions={setOrganismPositions}
                  onOpenOrganism={handleOpenOrganism}
                />
                {hasActiveFilters(filters) && sortedOrganisms.length === 0 && (
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
                allOrganisms={organisms}
                zonePics={zonePics}
                zones={zones}
                onOpenViewer={handleOpenFromSpotlight}
              />
            )}

          </div>
        )}
      </main>

      {status === "ready" && organisms.length > 0 && viewMode === "tree" && (
        <TreeView
          organisms={organisms}
          speciesByShortCode={speciesByShortCode}
          taxa={taxa}
          zones={zones}
          headerHeight={headerHeight}
          onOpenOrganismInList={handleOpenInList}
          onSpotlightOrganism={handleSpotlightOrganism}
          initialTreeNode={treeFocusNode}
          onNodeSelect={handleTreeNodeSelect}
          speciesLoaded={speciesLoaded}
          relationships={relationshipsData}
        />
      )}

      {status === "ready" && organisms.length > 0 && viewMode === "web" && (
        <WebView
          organisms={organisms}
          organismRecords={organismRecords}
          speciesByShortCode={speciesByShortCode}
          taxa={taxa}
          zones={zones}
          aiAnalyses={aiAnalyses}
          relationships={relationshipsData}
          headerHeight={headerHeight}
          onSpotlightOrganism={handleSpotlightOrganism}
          onOpenOrganismInList={handleOpenInList}
          initialWebNode={webFocusNode}
          onNodeSelect={handleWebNodeSelect}
        />
      )}

      <InfoModal
        open={infoOpen}
        onClose={handleCloseInfo}
        activeTab={infoTab}
        onTabChange={handleInfoTabChange}
        organisms={organisms}
        organismRecords={organismRecords}
        zones={zones}
        zonePics={zonePics}
        speciesByShortCode={speciesByShortCode}
        aiAnalyses={aiAnalyses}
        onSpotlightOrganism={handleSpotlightOrganism}
        onSpotlightZone={handleSpotlightZone}
        onSelectTaxon={handleSelectTaxon}
        onShowBioclipConflicts={handleShowBioclipConflicts}
        onShowEcoFit={handleShowEcoFit}
      />

      {openIndex >= 0 && (
        <OrganismViewer
          organism={viewerOrganisms[openIndex]}
          organisms={viewerOrganisms}
          allOrganisms={organisms}
          zones={zones}
          zonePics={zonePics}
          annotations={annotations}
          speciesByShortCode={speciesByShortCode}
          relationships={relationshipsData}
          currentIndex={openIndex}
          onClose={handleCloseViewer}
          onNavigate={handleNavigateViewer}
          onSelectOrganism={handleSelectOrganism}
          onSelectTaxon={handleSelectTaxon}
        />
      )}
    </div>
  );
}
