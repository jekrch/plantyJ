import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Leaf, Sprout, X } from "lucide-react";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { Organism, Species, TaxaInfo, Zone } from "../../types";
import type { RawNode } from "./types";
import { RANK_LABEL } from "./types";
import { organismTitle } from "../../utils/display";
import { speciesPicsFor } from "./treeUtils";
import { TabBtn } from "./CtrlBtn";
import type { AIAnalysis, AIVerdict } from "../OrganismInfoDrawer";
import { ModelAttribution } from "../ModelAttribution";
import { RelationsSubgraph } from "./RelationsSubgraph";
import type { RelationshipsData } from "../../hooks/useRelationships";

interface Props {
  node: HierarchyPointNode<RawNode>;
  organisms: Organism[];
  taxa: Record<string, TaxaInfo>;
  zones: Zone[];
  speciesByShortCode: Map<string, Species>;
  aiAnalyses?: AIAnalysis[];
  relationships?: RelationshipsData;
  isClosing?: boolean;
  onAnimationEnd?: () => void;
  onClose: () => void;
  onOpenOrganismInList: (organism: Organism, list: Organism[]) => void;
  onSpotlightOrganism: (shortCode: string) => void;
}

const VERDICT_COLOR: Record<AIVerdict, { color: string; filled: number }> = {
  GOOD: { color: "text-accent", filled: 3 },
  MIXED: { color: "text-amber-300", filled: 2 },
  BAD: { color: "text-rose-300", filled: 1 },
};

function VerdictBadge({ verdict }: { verdict: AIVerdict }) {
  const { color, filled } = VERDICT_COLOR[verdict];
  return (
    <div
      className="inline-flex items-center gap-1.5"
      title={`${verdict} fit`}
      aria-label={`Ecological fit: ${verdict}`}
    >
      <div className="inline-flex items-center gap-0.5">
        {[0, 1, 2].map((i) => {
          const active = i < filled;
          return (
            <Leaf
              key={i}
              size={11}
              strokeWidth={1.5}
              className={active ? color : "text-white/15"}
              fill={active ? "currentColor" : "none"}
              style={{ transform: `rotate(${-20 + i * 12}deg)` }}
            />
          );
        })}
      </div>
      <span className={`text-[9px] uppercase tracking-widest font-mono ${color}`}>
        {verdict}
      </span>
    </div>
  );
}

export function NodeDetail({
  node,
  organisms,
  taxa,
  zones,
  speciesByShortCode,
  aiAnalyses = [],
  relationships,
  isClosing,
  onAnimationEnd,
  onClose,
  onOpenOrganismInList,
  onSpotlightOrganism,
}: Props) {
  const isLeaf = !!node.data.organism;
  const baseURL = import.meta.env.BASE_URL;

  const organismsByCode = useMemo(() => {
    const m = new Map<string, Organism>();
    for (const p of organisms) {
      const existing = m.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        m.set(p.shortCode, p);
      }
    }
    return m;
  }, [organisms]);

  const relationCount = useMemo(() => {
    if (!isLeaf || !node.data.shortCode || !relationships) return 0;
    return (relationships.neighbors.get(node.data.shortCode) ?? []).length;
  }, [isLeaf, node, relationships]);

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

  const [tab, setTab] = useState<"info" | "images" | "relations">("info");

  useEffect(() => { setTab("info"); }, [node]);

  const speciesAnalyses = useMemo(() => {
    if (!isLeaf || !node.data.shortCode) return [] as AIAnalysis[];
    return aiAnalyses.filter((a) => a.shortCode === node.data.shortCode);
  }, [isLeaf, node, aiAnalyses]);

  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);

  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  useEffect(() => {
    setSelectedZone(speciesAnalyses[0]?.zoneCode ?? null);
  }, [speciesAnalyses]);

  const currentAnalysis = useMemo(() => {
    if (speciesAnalyses.length === 0) return null;
    return (
      speciesAnalyses.find((a) => a.zoneCode === selectedZone) ??
      speciesAnalyses[0]
    );
  }, [speciesAnalyses, selectedZone]);

  const shortCodes = useMemo(() => {
    const set = new Set<string>();
    node.descendants().forEach((d) => { if (d.data.shortCode) set.add(d.data.shortCode); });
    return set;
  }, [node]);

  const items = useMemo(() => {
    if (isLeaf) {
      return organisms
        .filter((p) => p.shortCode === node.data.shortCode!)
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
    }
    const repByCode = new Map<string, Organism>();
    for (const p of organisms) {
      if (!shortCodes.has(p.shortCode)) continue;
      const existing = repByCode.get(p.shortCode);
      if (!existing || new Date(p.addedAt) > new Date(existing.addedAt)) {
        repByCode.set(p.shortCode, p);
      }
    }
    return Array.from(repByCode.values()).sort((a, b) => organismTitle(a).localeCompare(organismTitle(b)));
  }, [isLeaf, node, organisms, shortCodes]);

  const ancestry = node.ancestors().reverse().filter((n) => n.depth > 0);
  const title = isLeaf ? organismTitle(node.data.organism!) : node.data.name;
  const subtitle = isLeaf ? node.data.organism?.fullName : RANK_LABEL[node.data.rank];

  const firstImage = items[0]?.image ?? null;

  return (
    <div
      className={`${isClosing ? "slide-down-out" : "slide-up-in"} relative overflow-hidden bg-surface-raised border border-ink-faint/20 rounded-t-xl h-[45vh] flex flex-col shadow-2xl`}
      onAnimationEnd={onAnimationEnd}
    >
      {firstImage && (
        <div
          className="absolute inset-y-0 right-0 w-3/4 pointer-events-none z-[-1]"
          style={{
            WebkitMaskImage: "linear-gradient(to right, transparent, black 45%)",
            maskImage: "linear-gradient(to right, transparent, black 45%)",
          }}
        >
          <img
            src={`${baseURL}${firstImage}`}
            alt=""
            className="w-full h-full object-cover opacity-[0.05] mix-blend-luminosity"
            draggable={false}
          />
        </div>
      )}
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
          {isLeaf && relationships && (
            <TabBtn active={tab === "relations"} onClick={() => setTab("relations")}>
              Web
              {relationCount > 0 && (
                <span className="ml-1 text-ink-faint normal-case tracking-normal">
                  ({relationCount})
                </span>
              )}
            </TabBtn>
          )}
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
          {currentAnalysis && (
            <div className="pt-2 border-t border-ink-faint/15">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[9px] font-mono uppercase tracking-wider text-ink-faint inline-flex items-center gap-1.5">
                  Ecological Fit Analysis (AI-generated)
                  <ModelAttribution iconSize={10} />
                </div>
                <VerdictBadge verdict={currentAnalysis.verdict} />
              </div>
              {speciesAnalyses.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1 mb-1.5">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-ink-faint mr-1">
                    Zone
                  </span>
                  {speciesAnalyses.map((a) => {
                    const active = a.zoneCode === currentAnalysis.zoneCode;
                    const label = zoneNameByCode.get(a.zoneCode) ?? a.zoneCode;
                    return (
                      <button
                        key={a.zoneCode}
                        type="button"
                        onClick={() => setSelectedZone(a.zoneCode)}
                        className={`text-[10px] leading-none px-2 py-1 rounded-sm transition-colors cursor-pointer ${
                          active
                            ? "bg-accent/20 text-accent ring-1 ring-inset ring-accent/40"
                            : "bg-white/5 text-ink-muted hover:bg-white/10 hover:text-ink"
                        }`}
                        title={label}
                      >
                        {label}
                        <span className="ml-1 text-[9px] font-mono opacity-60">
                          {a.zoneCode}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-ink-faint mb-1.5">
                  Zone:{" "}
                  <span className="text-ink-muted">
                    {zoneNameByCode.get(currentAnalysis.zoneCode) ??
                      currentAnalysis.zoneCode}
                  </span>{" "}
                  <span className="font-mono opacity-60">
                    {currentAnalysis.zoneCode}
                  </span>
                </div>
              )}
              <p className="text-[12px] leading-relaxed text-ink/85 whitespace-pre-line">
                {currentAnalysis.analysis}
              </p>
              {currentAnalysis.references && currentAnalysis.references.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentAnalysis.references.map((url) => {
                    let label = url;
                    try {
                      label = new URL(url).hostname.replace("www.", "");
                    } catch {
                      // keep raw URL
                    }
                    return (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-ink-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded-sm bg-white/5 hover:bg-white/8"
                      >
                        {label}
                        <ExternalLink size={9} strokeWidth={1.5} />
                      </a>
                    );
                  })}
                </div>
              )}
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
                    onClick={() => onOpenOrganismInList(p, speciesPicsFor(organisms, p.shortCode))}
                    className="panel-item relative overflow-hidden rounded-sm bg-surface ring-1 ring-inset ring-white/5 hover:ring-accent/40 transition-all break-inside-avoid mb-1.5 block w-full"
                    style={{ aspectRatio: aspect }}
                  >
                    <img
                      src={`${baseURL}${p.image}`}
                      alt={organismTitle(p)}
                      loading="lazy"
                      decoding="async"
                      className="block w-full h-full object-cover"
                      draggable={false}
                    />
                    {!isLeaf && (
                      <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white/85 bg-linear-to-t from-black/80 to-black/20 leading-tight truncate pointer-events-none">
                        {organismTitle(p)}
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
                onClick={() => onSpotlightOrganism(node.data.shortCode!)}
                className="flex items-center gap-1.5 text-[11px] font-display tracking-wider uppercase text-accent hover:text-accent-dim transition-colors"
              >
                <Sprout size={12} strokeWidth={1.5} />
                Spotlight this organism
              </button>
            </div>
          )}
        </div>

        {isLeaf && relationships && node.data.shortCode && (
          <div
            aria-hidden={tab !== "relations"}
            className={`h-full overflow-y-auto px-3 pt-3 pb-3 thin-scroll ${tab !== "relations" ? "hidden" : ""}`}
          >
            <RelationsSubgraph
              centerCode={node.data.shortCode}
              centerLabel={title}
              organisms={organisms}
              relationships={relationships.relationships}
              neighbors={relationships.neighbors}
              typeById={relationships.typeById}
              organismsByCode={organismsByCode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
