import type { Organism, Species, TaxaInfo, Zone } from "../../types";
import type { RelationshipsData } from "../../hooks/useRelationships";

export const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

export type Rank = (typeof RANKS)[number] | "root" | "variety";

export interface RawNode {
  name: string;
  rank: Rank;
  shortCode?: string;
  organism?: Organism;
  children?: RawNode[];
}

export interface Props {
  organisms: Organism[];
  speciesByShortCode: Map<string, Species>;
  taxa: Record<string, TaxaInfo>;
  zones: Zone[];
  headerHeight: number;
  onOpenOrganismInList: (organism: Organism, list: Organism[]) => void;
  onSpotlightOrganism: (shortCode: string) => void;
  initialTreeNode?: string | null;
  onNodeSelect?: (name: string | null) => void;
  speciesLoaded: boolean;
  relationships?: RelationshipsData;
}

export const LEAF_RADIUS = 22;
export const NODE_RADIUS_BASE = 4;
export const ROW_HEIGHT = 64;
export const COL_WIDTH = 150;
export const LABEL_COL = 220;
export const PAD_X = 60;
export const PAD_Y = 56;

// Multiplier applied to the fit-to-view zoom on first load. >1 zooms in past
// the "everything visible" baseline; the initial viewport is then anchored so
// the species column (right edge of tree) and rank headers (top) stay in view.
// Narrow/mobile screens get a smaller factor so more of the tree stays visible.
export const INITIAL_ZOOM_FACTOR_NARROW = 5.5;
export const INITIAL_ZOOM_FACTOR_WIDE = 6.5;
// Container widths at or below this are treated as mobile/narrow.
export const NARROW_SCREEN_WIDTH = 640;

// Absolute ceiling on the first-load zoom. The factor above is tuned for large
// gardens (like the founder garden) whose fit-to-view is height-dominated and
// therefore small; the tree's width is nearly constant across gardens since the
// taxonomy has a fixed column count. A small garden's fit-to-view is instead
// pinned by that width (or the 1.0 cap), so multiplying it by the same factor
// overshoots and opens absurdly zoomed in. Capping the initial zoom here makes
// every garden — small or large — open at roughly the founder-garden node
// scale. Users can still zoom in past this manually (bounded by maxK).
export const INITIAL_ZOOM_MAX_NARROW = 1.4;
export const INITIAL_ZOOM_MAX_WIDE = 1.15;

export const RANK_LABEL: Record<Rank, string> = {
  root: "Life",
  kingdom: "Kingdom",
  phylum: "Phylum",
  class: "Class",
  order: "Order",
  family: "Family",
  genus: "Genus",
  species: "Species",
  variety: "Variety",
};
