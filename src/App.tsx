import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { Sprout, House, ImagePlus } from "lucide-react";
import { sortOrganismsAsync } from "./utils/sorting.ts";
import { applyFilters, hasActiveFilters } from "./utils/filtering.ts";
import { activeOrganisms, buildRemovedSet, fullyRemovedShortCodes } from "./utils/removed.ts";
import MasonryGrid from "./components/MasonryGrid";
import BackgroundEchoes from "./components/BackgroundEchoes";
import { SpinnerState, ErrorState, EmptyState, SignInState } from "./components/StatusStates";
import SourceMenu from "./components/SourceMenu";
import { getSourceMode, isWritable } from "./data/source";
import { hasSeenWelcome } from "./components/welcomeSeen";
import GardenTour from "./components/GardenTour";
import ViewModeControl from "./components/ViewModeControl";
import type { Organism } from "./types";
import { useOrganismData } from "./hooks/useOrganismData";
import { useViewState } from "./hooks/useViewState";
import { useOrganismViewer } from "./hooks/useOrganismViewer";
import { lazyWithPreload, preloadWhenIdle } from "./lazy";

/**
 * Everything below is split out of the initial bundle. The gallery is what the
 * first paint needs; the tree and food web carry d3, the viewer carries the
 * lightbox, the about modal carries the stats charts, and the add sheet only
 * exists for signed-in writers. Each loads on the interaction that reveals it,
 * warmed ahead of time by `preloadWhenIdle` below where that's worth doing.
 */
const OrganismViewer = lazyWithPreload(() => import("./components/OrganismViewer"));
const InfoModal = lazyWithPreload(() => import("./components/InfoModal"));
const TreeView = lazyWithPreload(() => import("./components/TreeView"));
const WebView = lazyWithPreload(() => import("./components/WebView"));
const SpotlightView = lazyWithPreload(() => import("./components/SpotlightView"));
const AddEntrySheet = lazyWithPreload(() => import("./components/AddEntrySheet"));
const WelcomeModal = lazyWithPreload(() => import("./components/WelcomeModal"));

export default function App() {
  const data = useOrganismData();
  const view = useViewState();

  const filteredOrganisms = useMemo(
    () =>
      applyFilters(
        data.organisms,
        view.filters,
        data.annotations,
        data.speciesByShortCode,
        data.aiAnalyses,
      ),
    [data.organisms, view.filters, data.annotations, data.speciesByShortCode, data.aiAnalyses],
  );

  // A plant+zone combo flagged `removed` stays in the gallery/roll but is
  // filtered out of the tree, food web, and zone/plant views.
  const removedSet = useMemo(() => buildRemovedSet(data.annotations), [data.annotations]);
  const activeOrgs = useMemo(
    () => activeOrganisms(data.organisms, removedSet),
    [data.organisms, removedSet],
  );
  const removedShortCodes = useMemo(
    () => fullyRemovedShortCodes(data.organisms, removedSet),
    [data.organisms, removedSet],
  );

  const [sortedOrganisms, setSortedOrganisms] = useState<Organism[]>([]);
  useEffect(() => {
    let cancelled = false;
    sortOrganismsAsync(filteredOrganisms, view.sortMode).then((result) => {
      if (!cancelled) setSortedOrganisms(result);
    });
    return () => {
      cancelled = true;
    };
  }, [filteredOrganisms, view.sortMode]);

  // The plant view shows every pic of the plant — including removed plant+zone
  // combos (flagged with a Removed badge) — so removed plants like the oxeye
  // daisy remain visible there. The zone view keeps removed combos hidden.
  const spotlightOrganisms = useMemo(() => {
    if (view.viewMode === "gallery" || !view.spotlightCode) return [];
    const list =
      view.viewMode === "plant"
        ? data.organisms.filter((p) => p.shortCode === view.spotlightCode)
        : activeOrgs.filter((p) => p.zoneCode === view.spotlightCode);
    return [...list].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  }, [data.organisms, activeOrgs, view.viewMode, view.spotlightCode]);

  const viewer = useOrganismViewer({
    organisms: data.organisms,
    sortedOrganisms,
    spotlightOrganisms,
  });

  // Selecting a taxon is a cross-cutting action: it both focuses the tree
  // (view state) and dismisses any open organism (viewer state).
  const handleSelectTaxon = useCallback(
    (name: string) => {
      view.selectTaxon(name);
      viewer.resetViewer();
    },
    [view.selectTaxon, viewer.resetViewer],
  );

  const [imagesLoaded, setImagesLoaded] = useState(false);
  const handleLayoutReady = useCallback(() => setImagesLoaded(true), []);
  const [organismPositions, setOrganismPositions] = useState<
    { organism: Organism; y: number; h: number }[]
  >([]);

  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const writable = isWritable();

  // Lets a guided tour open the UI its steps point at. Memoized because the
  // tour rebuilds its steps whenever this identity changes.
  const tourControls = useMemo(
    () => ({
      openAddSheet: () => setAddOpen(true),
      closeAddSheet: () => setAddOpen(false),
      showWebView: () => view.handleViewModeChange("web", null),
    }),
    [view.handleViewModeChange],
  );

  // First visit to the founder's garden gets a one-time greeting pointing at
  // the cloud menu. Only in static mode: a Drive user has already started their
  // own journal, and a public-share visitor is looking at someone else's.
  const [welcomeOpen, setWelcomeOpen] = useState(
    () => getSourceMode() === "static" && !hasSeenWelcome(),
  );

  // The welcome and about modals animate themselves out, so they have to stay
  // mounted through the close. Latch on the first open instead of unmounting
  // with `open`: before that first open there's nothing to animate and no
  // reason to have fetched the chunk.
  const [welcomeMounted, setWelcomeMounted] = useState(welcomeOpen);
  const [infoMounted, setInfoMounted] = useState(false);
  useEffect(() => {
    if (welcomeOpen) setWelcomeMounted(true);
  }, [welcomeOpen]);
  useEffect(() => {
    if (view.infoOpen) setInfoMounted(true);
  }, [view.infoOpen]);

  // Warm the chunks behind the likeliest next taps once the garden has settled
  // and the browser is idle, so splitting them out doesn't make opening a photo
  // or switching views wait on a fetch.
  const dataReady = data.status === "ready";
  useEffect(() => {
    if (!dataReady) return;
    return preloadWhenIdle([OrganismViewer, InfoModal, TreeView, WebView, SpotlightView]);
  }, [dataReady]);

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
  }, [view.viewMode, data.status]);

  const { status, organisms } = data;
  const { viewMode } = view;

  return (
    <div className="min-h-screen bg-surface relative">
      {viewMode === "gallery" && <BackgroundEchoes organismPositions={organismPositions} />}
      <header
        ref={headerRef}
        className="sticky top-0 z-40 bg-surface/95 border-b border-ink-faint/30"
      >
        <div className="content-container px-1 py-0 flex items-center justify-between">
          <div className="flex items-center gap-2 px-2 py-2">
            <Sprout size={22} strokeWidth={1.5} className="stroke-accent" />
            <h1
              className="font-display font-bold text-xl tracking-tight text-ink cursor-pointer"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              PlantyJ
            </h1>
          </div>
          <div className="flex items-center gap-1 mr-2">
            {writable && status === "ready" && (
              <button
                onClick={() => setAddOpen(true)}
                data-tour="add"
                className="flex items-center justify-center h-8 w-8 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
                title="Add photos"
                aria-label="Add photos"
              >
                <ImagePlus size={20} strokeWidth={1.5} className="text-accent" />
              </button>
            )}
            <div data-tour="source" className="flex items-center">
              <SourceMenu />
            </div>
            <button
              onClick={view.handleOpenInfo}
              className="flex items-center justify-center h-8 w-8 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
              title="About this site"
              aria-label="About this site"
            >
              <House color={"#b08968"} size={20} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {status === "ready" &&
          organisms.length > 0 &&
          (viewMode === "tree" || viewMode === "web") && (
            <div
              data-tour="views"
              className="content-container px-1 pt-2 pb-3 border-t border-ink-faint/20"
            >
              <ViewModeControl
                mode={viewMode}
                subjectCode={view.spotlightCode}
                organisms={organisms}
                organismRecords={data.organismRecords}
                zones={data.zones}
                onChange={view.handleViewModeChange}
              />
            </div>
          )}
      </header>

      <main className="content-container px-1 pt-0 pb-12 sm:px-1 sm:pt-0">
        {status === "ready" &&
          organisms.length > 0 &&
          viewMode !== "tree" &&
          viewMode !== "web" && (
            <div data-tour="views" className="pt-2 pb-3">
              <ViewModeControl
                mode={viewMode}
                subjectCode={view.spotlightCode}
                organisms={organisms}
                organismRecords={data.organismRecords}
                zones={data.zones}
                onChange={view.handleViewModeChange}
              />
            </div>
          )}
        {(status === "loading" ||
          (status === "ready" &&
            organisms.length > 0 &&
            viewMode === "gallery" &&
            !imagesLoaded)) && <SpinnerState />}
        {status === "error" && <ErrorState />}
        {status === "needs-auth" && <SignInState headerHeight={headerHeight} />}
        {status === "ready" && organisms.length === 0 && (
          <EmptyState onAdd={writable ? () => setAddOpen(true) : undefined} />
        )}
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
                  zones={data.zones}
                  removedSet={removedSet}
                  annotations={data.annotations}
                  aiAnalyses={data.aiAnalyses}
                  sortMode={view.sortMode}
                  onSort={view.handleSortChange}
                  filters={view.filters}
                  onFiltersChange={view.handleFiltersChange}
                  onLayoutReady={handleLayoutReady}
                  onOrganismPositions={setOrganismPositions}
                  onOpenOrganism={viewer.openOrganism}
                />
                {hasActiveFilters(view.filters) && sortedOrganisms.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <p className="text-ink-muted text-sm font-display tracking-wide">NO MATCHES</p>
                    <button
                      onClick={view.clearFilters}
                      className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors font-display tracking-wider uppercase cursor-pointer"
                    >
                      CLEAR FILTERS
                    </button>
                  </div>
                )}
              </>
            )}

            {(viewMode === "plant" || viewMode === "zone") && view.spotlightCode && (
              <Suspense fallback={<SpinnerState />}>
                <SpotlightView
                  kind={viewMode}
                  subjectCode={view.spotlightCode}
                  allOrganisms={viewMode === "plant" ? data.organisms : activeOrgs}
                  removedSet={removedSet}
                  zonePics={data.zonePics}
                  zones={data.zones}
                  onOpenViewer={viewer.openFromSpotlight}
                  onDeleted={() => view.handleViewModeChange("gallery", null)}
                />
              </Suspense>
            )}
          </div>
        )}
      </main>

      {status === "ready" && organisms.length > 0 && viewMode === "tree" && (
        <Suspense fallback={<SpinnerState />}>
          <TreeView
            organisms={activeOrgs}
            speciesByShortCode={data.speciesByShortCode}
            taxa={data.taxa}
            zones={data.zones}
            headerHeight={headerHeight}
            onOpenOrganismInList={viewer.openInList}
            onSpotlightOrganism={view.handleSpotlightOrganism}
            initialTreeNode={view.treeFocusNode}
            onNodeSelect={view.handleTreeNodeSelect}
            speciesLoaded={data.speciesLoaded}
            relationships={data.relationships}
          />
        </Suspense>
      )}

      {status === "ready" && organisms.length > 0 && viewMode === "web" && (
        <Suspense fallback={<SpinnerState />}>
          <WebView
            organisms={activeOrgs}
            organismRecords={data.organismRecords}
            removedShortCodes={removedShortCodes}
            speciesByShortCode={data.speciesByShortCode}
            taxa={data.taxa}
            zones={data.zones}
            aiAnalyses={data.aiAnalyses}
            relationships={data.relationships}
            headerHeight={headerHeight}
            onSpotlightOrganism={view.handleSpotlightOrganism}
            onOpenOrganismInList={viewer.openInList}
            initialWebNode={view.webFocusNode}
            onNodeSelect={view.handleWebNodeSelect}
          />
        </Suspense>
      )}

      {welcomeMounted && (
        <Suspense fallback={null}>
          <WelcomeModal open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
        </Suspense>
      )}

      {/* `ready` gates only the automatic tour: a spotlight measured against an
          overlay lands in the wrong place, and two overlapping introductions is
          one too many. Tours the user picks deliberately are not gated — the
          add-specimen tour opens the add sheet itself. */}
      <GardenTour
        organismCount={organisms.length}
        controls={tourControls}
        ready={
          status === "ready" &&
          !welcomeOpen &&
          !addOpen &&
          !view.infoOpen &&
          viewer.openIndex < 0 &&
          (organisms.length === 0 || imagesLoaded)
        }
      />

      {infoMounted && (
        <Suspense fallback={null}>
          <InfoModal
            open={view.infoOpen}
            onClose={view.handleCloseInfo}
            activeTab={view.infoTab}
            onTabChange={view.handleInfoTabChange}
            organisms={organisms}
            activeOrganisms={activeOrgs}
            removedShortCodes={removedShortCodes}
            organismRecords={data.organismRecords}
            zones={data.zones}
            zonePics={data.zonePics}
            speciesByShortCode={data.speciesByShortCode}
            aiAnalyses={data.aiAnalyses}
            onSpotlightOrganism={view.handleSpotlightOrganism}
            onSpotlightZone={view.handleSpotlightZone}
            onSelectTaxon={handleSelectTaxon}
            onShowBioclipConflicts={view.handleShowBioclipConflicts}
            onShowEcoFit={view.handleShowEcoFit}
          />
        </Suspense>
      )}

      {writable && addOpen && (
        <Suspense fallback={null}>
          <AddEntrySheet
            open={addOpen}
            onClose={() => setAddOpen(false)}
            organismRecords={data.organismRecords}
            zones={data.zones}
          />
        </Suspense>
      )}

      {viewer.openIndex >= 0 && (
        <Suspense fallback={null}>
          <OrganismViewer
            organism={viewer.viewerOrganisms[viewer.openIndex]}
            organisms={viewer.viewerOrganisms}
            allOrganisms={organisms}
            zones={data.zones}
            zonePics={data.zonePics}
            annotations={data.annotations}
            speciesByShortCode={data.speciesByShortCode}
            relationships={data.relationships}
            currentIndex={viewer.openIndex}
            onClose={viewer.closeViewer}
            onNavigate={viewer.navigateViewer}
            onSelectOrganism={viewer.selectOrganism}
            onSelectTaxon={handleSelectTaxon}
          />
        </Suspense>
      )}
    </div>
  );
}
