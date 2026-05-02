import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Sprout, X } from "lucide-react";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { Plant, Species, TaxaInfo } from "../../types";
import type { RawNode } from "./types";
import { RANK_LABEL } from "./types";
import { plantTitle } from "../../utils/display";
import { speciesPicsFor } from "./treeUtils";
import { TabBtn } from "./CtrlBtn";

interface Props {
  node: HierarchyPointNode<RawNode>;
  plants: Plant[];
  taxa: Record<string, TaxaInfo>;
  speciesByShortCode: Map<string, Species>;
  isClosing?: boolean;
  onAnimationEnd?: () => void;
  onClose: () => void;
  onOpenPlantInList: (plant: Plant, list: Plant[]) => void;
  onSpotlightPlant: (shortCode: string) => void;
}

export function NodeDetail({
  node,
  plants,
  taxa,
  speciesByShortCode,
  isClosing,
  onAnimationEnd,
  onClose,
  onOpenPlantInList,
  onSpotlightPlant,
}: Props) {
  const isLeaf = !!node.data.plant;
  const baseURL = import.meta.env.BASE_URL;

  const species = isLeaf && node.data.shortCode
    ? speciesByShortCode.get(node.data.shortCode) ?? null
    : null;

  const taxaInfo = taxa[node.data.name];
  const description = isLeaf
    ? species?.description ?? null
    : taxaInfo?.description ?? null;
  const references: { name: string; url: string }[] = isLeaf
    ? species?.references ?? []
    : taxaInfo?.url
      ? [{ name: "Wikipedia", url: taxaInfo.url }]
      : [];

  const [tab, setTab] = useState<"info" | "images">("info");

  useEffect(() => { setTab("info"); }, [node]);

  const shortCodes = useMemo(() => {
    const set = new Set<string>();
    node.descendants().forEach((d) => { if (d.data.shortCode) set.add(d.data.shortCode); });
    return set;
  }, [node]);

  const items = useMemo(() => {
    if (isLeaf) {
      return plants
        .filter((p) => p.shortCode === node.data.shortCode!)
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
    }
    const repByCode = new Map<string, Plant>();
    for (const p of plants) {
      if (!shortCodes.has(p.shortCode)) continue;
      const existing = repByCode.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        repByCode.set(p.shortCode, p);
      }
    }
    return Array.from(repByCode.values()).sort((a, b) => plantTitle(a).localeCompare(plantTitle(b)));
  }, [isLeaf, node, plants, shortCodes]);

  const ancestry = node.ancestors().reverse().filter((n) => n.depth > 0);
  const title = isLeaf ? plantTitle(node.data.plant!) : node.data.name;
  const subtitle = isLeaf ? node.data.plant?.fullName : RANK_LABEL[node.data.rank];

  return (
    <div
      className={`${isClosing ? "slide-down-out" : "slide-up-in"} bg-surface-raised border border-ink-faint/20 rounded-t-xl h-[45vh] flex flex-col shadow-2xl`}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="shrink-0 px-3 pt-3">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-sm font-display text-ink leading-tight">{title}</h3>
              {subtitle && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint">
                  {subtitle}
                </span>
              )}
            </div>
            {ancestry.length > 0 && (
              <p className="text-[10px] font-mono text-ink-faint mt-1 truncate">
                {ancestry.map((a) => a.data.name).join(" › ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-4 border-b border-ink-faint/20">
          <TabBtn active={tab === "info"} onClick={() => setTab("info")}>
            Info
          </TabBtn>
          <TabBtn active={tab === "images"} onClick={() => setTab("images")}>
            Images
            {items.length > 0 && (
              <span className="ml-1 text-ink-faint normal-case tracking-normal">
                ({items.length})
              </span>
            )}
          </TabBtn>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div
          aria-hidden={tab !== "info"}
          className={`h-full overflow-y-auto px-3 pt-3 pb-3 thin-scroll flex flex-col gap-3 ${tab !== "info" ? "hidden" : ""}`}
        >
          <div className="flex-1">
            {description ? (
              <p className="text-[12px] leading-relaxed text-ink/90 max-w-[60em] whitespace-pre-line">
                {description.replace(/(?<!\n)\n(?!\n)/g, "\n\n")}
              </p>
            ) : (
              <p className="text-[11px] text-ink-faint italic">
                No description available for {title}.
              </p>
            )}
          </div>
          {references.length > 0 && (
            <div className="pt-2 border-t border-ink-faint/15">
              <div className="text-[9px] font-mono uppercase tracking-wider text-ink-faint mb-1.5">
                Sources
              </div>
              <div className="flex flex-wrap gap-1.5">
                {references.map((r) => (
                  <a
                    key={r.url}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-accent transition-colors px-2 py-1 rounded-sm bg-white/5 hover:bg-white/8"
                  >
                    {r.name}
                    <ExternalLink size={10} strokeWidth={1.5} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          aria-hidden={tab !== "images"}
          className={`h-full overflow-y-auto px-3 pt-3 pb-3 thin-scroll ${tab !== "images" ? "hidden" : ""}`}
        >
          {items.length === 0 ? (
            <p className="text-[11px] text-ink-faint">No images yet.</p>
          ) : (
            <div className="columns-3 sm:columns-4 md:columns-5 lg:columns-6 gap-1.5">
              {items.map((p) => {
                const aspect = p.width && p.height ? `${p.width} / ${p.height}` : "3 / 4";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenPlantInList(p, speciesPicsFor(plants, p.shortCode))}
                    className="panel-item relative overflow-hidden rounded-sm bg-surface ring-1 ring-inset ring-white/5 hover:ring-accent/40 transition-all break-inside-avoid mb-1.5 block w-full"
                    style={{ aspectRatio: aspect }}
                  >
                    <img
                      src={`${baseURL}${p.image}`}
                      alt={plantTitle(p)}
                      loading="lazy"
                      decoding="async"
                      className="block w-full h-full object-cover"
                      draggable={false}
                    />
                    {!isLeaf && (
                      <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white/85 bg-linear-to-t from-black/80 to-black/20 leading-tight truncate pointer-events-none">
                        {plantTitle(p)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {isLeaf && node.data.shortCode && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => onSpotlightPlant(node.data.shortCode!)}
                className="flex items-center gap-1.5 text-[11px] font-display tracking-wider uppercase text-accent hover:text-accent-dim transition-colors"
              >
                <Sprout size={12} strokeWidth={1.5} />
                Spotlight this plant
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
