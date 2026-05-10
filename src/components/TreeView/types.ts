import type { Plant, Species, TaxaInfo, Zone } from "../../types";
import type { RelationshipsData } from "../../hooks/useRelationships";

export const RANKS = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
] as const;

export type Rank = (typeof RANKS)[number] | "root";

export interface RawNode {
  name: string;
  rank: Rank;
  shortCode?: string;
  plant?: Plant;
  children?: RawNode[];
}

export interface Props {
  plants: Plant[];
  speciesByShortCode: Map<string, Species>;
  taxa: Record<string, TaxaInfo>;
  zones: Zone[];
  headerHeight: number;
  onOpenPlantInList: (plant: Plant, list: Plant[]) => void;
  onSpotlightPlant: (shortCode: string) => void;
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
export const INITIAL_ZOOM_FACTOR = 3.5;

export const RANK_LABEL: Record<Rank, string> = {
  root: "Life",
  kingdom: "Kingdom",
  phylum: "Phylum",
  class: "Class",
  order: "Order",
  family: "Family",
  genus: "Genus",
  species: "Species",
};
