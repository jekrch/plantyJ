import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Plant, Species, SpeciesTaxonomy, Zone } from "../types";

interface Props {
  open: boolean;
  plant: Plant;
  allPlants: Plant[];
  zones: Zone[];
  speciesByShortCode: Map<string, Species>;
  onSelectPlant: (plant: Plant) => void;
  onApplyShortCodes: (shortCodes: string[]) => void;
  topOffset?: number;
  bottomOffset?: number;
  closing?: boolean;
  slideDir?: "left" | "right" | null;
}

const TAXONOMY_RANKS: Array<keyof SpeciesTaxonomy> = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
];

const DESCRIPTION_PREVIEW_CHARS = 260;

function firstSentenceOrTrim(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastBoundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? ")
  );
  if (lastBoundary > max * 0.5) return slice.slice(0, lastBoundary + 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

interface TaxonomyRow {
  rank: keyof SpeciesTaxonomy;
  value: string;
  matchingShortCodes: string[];
}

export default function PlantInfoDrawer({
  open,
  plant,
  allPlants,
  zones,
  speciesByShortCode,
  onSelectPlant,
  onApplyShortCodes,
  topOffset = 0,
  bottomOffset = 0,
  closing = false,
  slideDir = null,
}: Props) {
  const [descExpanded, setDescExpanded] = useState(false);
  const [expandedRank, setExpandedRank] = useState<keyof SpeciesTaxonomy | null>(
    null
  );

  useEffect(() => {
    setDescExpanded(false);
    setExpandedRank(null);
  }, [plant.id]);

  const species = speciesByShortCode.get(plant.shortCode) ?? null;

  const samePlantTimeline = allPlants
    .filter((p) => p.shortCode === plant.shortCode && p.id !== plant.id)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);

  const sharingZone = allPlants
    .filter(
      (p) =>
        p.shortCode !== plant.shortCode &&
        p.zoneCode === plant.zoneCode
    )
    .reduce<Plant[]>((acc, p) => {
      if (!acc.some((existing) => existing.shortCode === p.shortCode)) acc.push(p);
      return acc;
    }, []);

  const sharingHeader = `Others in ${zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode}`;

  const otherVernaculars = useMemo(() => {
    if (!species?.vernacularNames?.length) return [] as string[];
    const known = new Set(
      [plant.commonName, species.commonName]
        .filter((s): s is string => !!s)
        .map((s) => s.toLowerCase())
    );
    const seen = new Set<string>();
    return species.vernacularNames.filter((n) => {
      const key = n.toLowerCase();
      if (known.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [species, plant.commonName]);

  const plantByShortCode = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of allPlants) if (!m.has(p.shortCode)) m.set(p.shortCode, p);
    return m;
  }, [allPlants]);

  const taxonomyRows: TaxonomyRow[] = useMemo(() => {
    if (!species?.taxonomy) return [];
    return TAXONOMY_RANKS.flatMap((rank) => {
      const value = species.taxonomy?.[rank];
      if (!value) return [];
      const matching: string[] = [];
      for (const [code, sp] of speciesByShortCode) {
        if (sp.taxonomy?.[rank] === value) matching.push(code);
      }
      return [{ rank, value: value as string, matchingShortCodes: matching }];
    });
  }, [species, speciesByShortCode]);

  const bioclipSpeciesId = plant.bioclipSpeciesId?.trim() || null;
  const bioclipCommonName = plant.bioclipCommonName?.trim() || null;
  const bioclipScore =
    typeof plant.bioclipScore === "number" ? plant.bioclipScore : null;
  const recordedSpecies =
    species?.fullName?.trim() || plant.fullName?.trim() || null;
  const bioclipMatch: "match" | "genus" | "mismatch" | null = (() => {
    if (!bioclipSpeciesId || !recordedSpecies) return null;
    const a = bioclipSpeciesId.toLowerCase();
    const b = recordedSpecies.toLowerCase();
    if (a === b) return "match";
    const genusA = a.split(/\s+/)[0];
    const genusB = b.split(/\s+/)[0];
    if (genusA && genusA === genusB) return "genus";
    return "mismatch";
  })();

  const description = species?.description?.trim() || null;
  const needsTruncation =
    !!description && description.length > DESCRIPTION_PREVIEW_CHARS;
  const visibleDescription = description
    ? descExpanded || !needsTruncation
      ? description
      : firstSentenceOrTrim(description, DESCRIPTION_PREVIEW_CHARS)
    : null;

  const show = open && !closing;

  let transform = show ? "translateY(0)" : "translateY(100vh)";
  if (slideDir && !show) {
    transform = `translateX(${slideDir === "left" ? "-100%" : "100%"})`;
  }
  if (closing) transform = "translateY(0)";

  return (
    <div
      className="absolute inset-x-0 z-15 overflow-y-auto info-modal-scroll"
      style={{
        top: topOffset,
        bottom: bottomOffset,
        transform,
        opacity: closing ? 0 : 1,
        transition: closing
          ? "opacity 0.25s ease-out"
          : slideDir
            ? "transform 0.28s cubic-bezier(0.2, 0, 0, 1)"
            : "transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)",
        pointerEvents: show ? "auto" : "none",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="px-6 py-6 sm:px-10 sm:py-8 space-y-5 max-w-lg lg:max-w-xl mx-auto w-full"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.25s ease-out 0.15s, transform 0.25s ease-out 0.15s",
        }}
      >
        {/* Plant identity */}
        <div 
          className="relative overflow-hidden rounded px-4 py-3" 
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          {/* Fading Background Image */}
          {plant.image && (
            <div
              className="absolute inset-y-0 right-0 w-2/3 sm:w-1/2 pointer-events-none z-0"
              style={{
                // Mask fades from transparent on the left to solid on the right
                WebkitMaskImage: "linear-gradient(to right, transparent, black 80%)",
                maskImage: "linear-gradient(to right, transparent, black 80%)",
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${plant.image}`}
                alt=""
                className="w-full h-full object-cover opacity-40 mix-blend-luminosity" 
              />
            </div>
          )}

          {/* Text Content */}
          <div className="relative z-10 pointer-events-none">
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">Plant</p>
            <p className="font-display text-sm text-white/90 leading-snug">
              {plant.commonName ?? plant.fullName ?? plant.shortCode}{" "}
              <span className="text-accent text-xs">{plant.shortCode}</span>
            </p>
            {plant.fullName && plant.commonName && (
              <p className="text-[11px] text-white/50 italic mt-0.5">{plant.fullName}</p>
            )}
          </div>
        </div>

        {/* Description */}
        {plant.description && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">Notes</p>
              <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line">
                {plant.description}
              </p>
            </div>
          </>
        )}

        {/* Tags */}
        {plant.tags?.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {plant.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] leading-none px-1.5 py-[3.9px] rounded-sm bg-white/8 text-white/35"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Same plant timeline */}
        {samePlantTimeline.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/50">
                <span>More photos of this plant</span>
                <span className="text-white/20 normal-case tracking-normal">
                  · {samePlantTimeline.length}
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 info-related-scroll">
                {samePlantTimeline.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPlant(p)}
                    className="relative shrink-0 h-24 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                    style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    title={new Date(p.addedAt).toLocaleDateString()}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${p.image}`}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[9px] text-white/80 bg-gradient-to-t from-black/80 to-transparent leading-tight">
                      {new Date(p.addedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

      {/* Zone */}
        <div className="rounded px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">Zone</p>
          <p className="font-display text-sm text-white/90 leading-snug">
            {zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode}{" "}
            <span className="text-accent">{plant.zoneCode}</span>
          </p>
        </div>

        {/* Other plants sharing a zone */}
        {sharingZone.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/50">
                <span>{sharingHeader}</span>
                <span className="text-white/20 normal-case tracking-normal">· {sharingZone.length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 info-related-scroll">
                {sharingZone.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectPlant(p)}
                    className="relative shrink-0 h-24 rounded-sm overflow-hidden bg-white/5 ring-1 ring-inset ring-white/5 hover:ring-white/25 transition-colors"
                    style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    title={p.commonName ?? p.shortCode}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${p.image}`}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[9px] text-white/80 bg-gradient-to-t from-black/80 to-transparent leading-tight">
                      {p.commonName ?? p.shortCode}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Species overview */}
        {description && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">
              About this species
            </p>
            <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line">
              {visibleDescription}
            </p>
            {needsTruncation && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="mt-1.5 text-[10px] uppercase tracking-widest text-accent/80 hover:text-accent transition-colors cursor-pointer"
              >
                {descExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {/* Vernacular names */}
        {otherVernaculars.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">
              Also known as
            </p>
            <div className="flex flex-wrap gap-1.5">
              {otherVernaculars.map((name) => (
                <span
                  key={name}
                  className="text-[11px] leading-none px-2 py-1 rounded-sm bg-white/5 text-white/55 italic"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Taxonomic lineage */}
        {taxonomyRows.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[10px] uppercase tracking-widest text-white/50">
                Classification
              </p>
              <p className="text-[9px] uppercase tracking-widest text-white/20">
                tap to filter
              </p>
            </div>
            <ol className="space-y-1">
              {taxonomyRows.map((row, idx) => {
                const isLast = idx === taxonomyRows.length - 1;
                const siblingCodes = row.matchingShortCodes.filter(
                  (c) => c !== plant.shortCode
                );
                const total = row.matchingShortCodes.length;
                const isExpandable = siblingCodes.length > 0;
                const isExpanded = expandedRank === row.rank;
                return (
                  <li key={row.rank} style={{ paddingLeft: `${idx * 10}px` }}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[9px] uppercase tracking-widest text-white/35 w-14 shrink-0 font-mono">
                        {row.rank}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onApplyShortCodes(row.matchingShortCodes)
                        }
                        className={`text-left hover:text-accent transition-colors cursor-pointer ${
                          isLast ? "text-accent italic" : "text-white/65"
                        }`}
                        title={`Filter to ${total} plant${total === 1 ? "" : "s"}`}
                      >
                        {row.value}
                      </button>
                      {isExpandable && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRank(isExpanded ? null : row.rank)
                          }
                          className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-white/35 hover:text-white/70 transition-colors cursor-pointer px-1.5 py-0.5 rounded-sm hover:bg-white/5"
                          title={
                            isExpanded
                              ? "Hide siblings"
                              : `Show ${siblingCodes.length} other${siblingCodes.length === 1 ? "" : "s"}`
                          }
                          aria-expanded={isExpanded}
                        >
                          <span className="tabular-nums">
                            +{siblingCodes.length}
                          </span>
                          <ChevronDown
                            size={11}
                            strokeWidth={1.5}
                            style={{
                              transform: isExpanded
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                              transition: "transform 0.2s ease-out",
                            }}
                          />
                        </button>
                      )}
                    </div>
                    {isExpandable && isExpanded && (
                      <div
                        className="flex flex-wrap gap-1.5 mt-1.5 mb-1"
                        style={{ paddingLeft: "calc(3.5rem + 0.5rem)" }}
                      >
                        {siblingCodes.map((code) => {
                          const sibPlant = plantByShortCode.get(code);
                          const sibSpecies = speciesByShortCode.get(code);
                          const label =
                            sibPlant?.commonName ??
                            sibPlant?.fullName ??
                            sibSpecies?.commonName ??
                            sibSpecies?.fullName ??
                            code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => onApplyShortCodes([code])}
                              className="text-[11px] leading-none px-2 py-1 rounded-sm bg-white/5 text-white/60 hover:bg-accent/15 hover:text-accent transition-colors cursor-pointer"
                              title={sibSpecies?.fullName ?? sibPlant?.fullName ?? code}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Native range */}
        {species?.nativeRange && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">
              Native range
            </p>
            <p className="text-xs text-white/55 leading-relaxed">
              {species.nativeRange}
            </p>
          </div>
        )}   
        
        {/* BioCLIP prediction */}
        {bioclipSpeciesId && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-white/50">
                  BioCLIP prediction
                </p>
                {bioclipScore !== null && (
                  <p className="text-[9px] uppercase tracking-widest text-white/35 tabular-nums">
                    {(bioclipScore * 100).toFixed(1)}% confidence
                  </p>
                )}
              </div>
              <div
                className="rounded px-4 py-3 space-y-2"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                <div>
                  <p className="font-display text-sm text-white/70 italic leading-snug">
                    {bioclipSpeciesId}
                  </p>
                  {bioclipCommonName && (
                    <p className="text-[11px] text-white/50 mt-0.5">
                      {bioclipCommonName}
                    </p>
                  )}
                </div>
                {bioclipMatch && recordedSpecies && (
                  <p
                    className={`text-[11px] leading-snug ${
                      bioclipMatch === "match"
                        ? "text-accent/90"
                        : bioclipMatch === "genus"
                          ? "text-amber-300/80"
                          : "text-rose-300/80"
                    }`}
                  >
                    {bioclipMatch === "match" &&
                      `Agrees with the recorded species (${recordedSpecies}).`}
                    {bioclipMatch === "genus" &&
                      `Same genus as the recorded species (${recordedSpecies}), but a different species.`}
                    {bioclipMatch === "mismatch" &&
                      `Disagrees with the recorded species (${recordedSpecies}).`}
                  </p>
                )}
              </div>
              <a
                href="https://imageomics.github.io/bioclip/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-accent transition-colors mt-2 px-2 py-1 rounded-sm bg-white/5 hover:bg-white/8"
              >
                About BioCLIP
                <ExternalLink size={10} strokeWidth={1.5} />
              </a>
            </div>
          </>
        )}

        {/* Sources */}
        {species?.references && species.references.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-2">
                Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {species.references.map((ref) => (
                  <a
                    key={ref.url}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-accent transition-colors px-2 py-1 rounded-sm bg-white/5 hover:bg-white/8"
                  >
                    {ref.name}
                    <ExternalLink size={10} strokeWidth={1.5} />
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
