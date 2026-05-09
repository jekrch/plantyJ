import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Leaf } from "lucide-react";
import type { AIAnalysis, AIVerdict, Annotation, Plant, Species, SpeciesTaxonomy, Zone, ZonePic } from "../types";
import { plantTitle } from "../utils/display";
import { ModelAttribution } from "./ModelAttribution";

export type { AIAnalysis, AIVerdict };

const VERDICT_METER: Record<AIVerdict, { filled: number; color: string }> = {
  GOOD: { filled: 3, color: "text-accent" },
  MIXED: { filled: 2, color: "text-amber-300" },
  BAD: { filled: 1, color: "text-rose-300" },
};

function VerdictMeter({ verdict }: { verdict: AIVerdict }) {
  const { filled, color } = VERDICT_METER[verdict];
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
              size={12}
              strokeWidth={1.5}
              className={active ? color : "text-white/15"}
              fill={active ? "currentColor" : "none"}
              style={{
                transform: `rotate(${-20 + i * 12}deg)`,
              }}
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

interface Props {
  open: boolean;
  plant: Plant;
  allPlants: Plant[];
  zones: Zone[];
  zonePics: ZonePic[];
  annotations: Annotation[];
  speciesByShortCode: Map<string, Species>;
  aiAnalyses?: AIAnalysis[];
  onSelectPlant: (plant: Plant) => void;
  onSelectTaxon: (name: string) => void;
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
  zonePics,
  annotations,
  speciesByShortCode,
  aiAnalyses = [],
  onSelectPlant,
  onSelectTaxon,
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

  const matchingZonePic = useMemo(() => {
    const candidates = zonePics.filter((z) => z.zoneCode === plant.zoneCode);
    if (candidates.length === 0) return null;
    const target = new Date(plant.addedAt).getTime();
    let best = candidates[0];
    let bestDelta = Math.abs(new Date(best.addedAt).getTime() - target);
    for (let i = 1; i < candidates.length; i++) {
      const delta = Math.abs(new Date(candidates[i].addedAt).getTime() - target);
      if (delta < bestDelta) {
        best = candidates[i];
        bestDelta = delta;
      }
    }
    return best;
  }, [zonePics, plant.zoneCode, plant.addedAt]);

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
  const bioclipWikiUrl = plant.bioclipWikiUrl?.trim() || null;
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

  const description = species?.description?.trim().replace(/(?<!\n)\n(?!\n)/g, '\n\n') || null;
  const needsTruncation =
    !!description && description.length > DESCRIPTION_PREVIEW_CHARS;
  const visibleDescription = description
    ? descExpanded || !needsTruncation
      ? description
      : firstSentenceOrTrim(description, DESCRIPTION_PREVIEW_CHARS)
    : null;

  const note = plant.description?.trim() || null;
  const tags = plant.tags ?? [];

  const plantAnnotation =
    annotations.find((a) => a.shortCode === plant.shortCode && a.zoneCode === null) ?? null;
  const zoneAnnotation =
    annotations.find(
      (a) => a.shortCode === plant.shortCode && a.zoneCode === plant.zoneCode
    ) ?? null;
  const zoneName = zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode;

  const currentAnalysis = useMemo(() => {
    return aiAnalyses.find(
      (a) => a.shortCode === plant.shortCode && a.zoneCode === plant.zoneCode
    ) ?? null;
  }, [aiAnalyses, plant.shortCode, plant.zoneCode]);

  const show = open && !closing;

  let transform = show ? "translateY(0)" : "translateY(100vh)";
  if (slideDir && !show) {
    transform = `translateX(${slideDir === "left" ? "-100%" : "100%"})`;
  }
  if (closing) transform = "translateY(0)";

  return (
    <div
      className="absolute inset-x-0 z-15 overflow-y-auto info-modal-scroll thin-scroll"
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
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">{plant.kind === "animal" ? "Animal" : "Plant"}</p>
            <p className="font-display text-sm text-white/90 leading-snug">
              {plantTitle(plant)}{" "}
              <span className="text-accent text-xs">{plant.shortCode}</span>
            </p>
            {plant.fullName && plant.commonName && (
              <p className="text-[11px] text-white/50 italic mt-0.5">{plant.fullName}{plant.variety && ` '${plant.variety}'`}</p>
            )}
            {!plant.commonName && plant.variety && (
              <p className="text-[11px] text-white/40 mt-0.5">'{plant.variety}'</p>
            )}
          </div>
        </div>

        {/* Plant, zone, and photo annotations — all side by side if they fit */}
        {(plantAnnotation || zoneAnnotation || note || tags.length > 0) && (
          <>
            <div className="border-t border-white/8" />
            <div className="flex flex-wrap gap-x-6 gap-y-3 items-start">
              {plantAnnotation && (plantAnnotation.description || plantAnnotation.tags.length > 0) && (
                <AnnotationGroup
                  noteLabel="Plant notes"
                  tagsLabel="Plant tags"
                  description={plantAnnotation.description}
                  tags={plantAnnotation.tags}
                />
              )}
              {zoneAnnotation && (zoneAnnotation.description || zoneAnnotation.tags.length > 0) && (
                <AnnotationGroup
                  noteLabel={`${zoneName} notes`}
                  tagsLabel={`${zoneName} tags`}
                  description={zoneAnnotation.description}
                  tags={zoneAnnotation.tags}
                />
              )}
              {(note || tags.length > 0) && (
                <AnnotationGroup
                  noteLabel="Photo notes"
                  tagsLabel="Photo tags"
                  description={note}
                  tags={tags}
                />
              )}
            </div>
          </>
        )}

        {/* Same plant timeline */}
        {samePlantTimeline.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/50">
                <span>More photos of this {plant.kind === "animal" ? "animal" : "plant"}</span>
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
                      decoding="async"
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
        <div
          className="relative overflow-hidden rounded px-4 py-14"
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          {matchingZonePic && (
            <div
              className="absolute inset-y-0 right-0 w-4/5 sm:w-1/2 pointer-events-none z-0"
              style={{
                WebkitMaskImage: "linear-gradient(to right, transparent, black 20%)",
                maskImage: "linear-gradient(to right, transparent, black 20%)",
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${matchingZonePic.image}`}
                alt=""
                className="w-full h-full object-cover opacity-40 mix-blend-luminosity"
              />
            </div>
          )}

          <div className="relative z-10 pointer-events-none">
            <p className="text-[10px] uppercase tracking-widest text-white/50 mb-1.5">Zone</p>
            <p className="font-display text-sm text-white/90 leading-snug">
              {zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode}{" "}
              <span className="text-accent text-xs">{plant.zoneCode}</span>
            </p>
          </div>
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
                      decoding="async"
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
                tap to view in tree
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
                        onClick={() => onSelectTaxon(row.value)}
                        className={`text-left hover:text-accent transition-colors cursor-pointer ${
                          isLast ? "text-accent italic" : "text-white/65"
                        }`}
                        title={`View ${row.value} in tree (${total} plant${total === 1 ? "" : "s"})`}
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
                          const focusName =
                            sibSpecies?.taxonomy?.species ?? null;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() =>
                                focusName && onSelectTaxon(focusName)
                              }
                              disabled={!focusName}
                              className="text-[11px] leading-none px-2 py-1 rounded-sm bg-white/5 text-white/60 hover:bg-accent/15 hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
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
                  {bioclipMatch !== "match" ? (
                    <a
                      href={bioclipWikiUrl || `https://www.google.com/search?q=${encodeURIComponent(bioclipSpeciesId ?? "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-display text-sm text-white/70 italic leading-snug hover:text-accent transition-colors inline-flex items-center gap-1"
                    >
                      {bioclipSpeciesId}
                      <ExternalLink size={10} strokeWidth={1.5} className="shrink-0 not-italic" />
                    </a>
                  ) : (
                    <p className="font-display text-sm text-white/70 italic leading-snug">
                      {bioclipSpeciesId}
                    </p>
                  )}
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
        {((species?.references && species.references.length > 0) || (plant.kind === "animal" && plant.fullName)) && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50 mb-2">
                Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {species?.references?.map((ref) => (
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
                {plant.kind === "animal" && plant.fullName && (
                  <a
                    href={`https://www.inaturalist.org/taxa/search?q=${encodeURIComponent(plant.fullName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-white/55 hover:text-accent transition-colors px-2 py-1 rounded-sm bg-white/5 hover:bg-white/8"
                  >
                    iNaturalist
                    <ExternalLink size={10} strokeWidth={1.5} />
                  </a>
                )}
              </div>
            </div>
          </>
        )}

        {/* AI Ecological Fit Analysis */}
        {currentAnalysis && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="text-[10px] uppercase tracking-widest text-white/50 inline-flex items-center gap-1.5">
                  Ecological Fit Analysis (AI-generated)
                  <ModelAttribution iconSize={11} />
                </p>
                <VerdictMeter verdict={currentAnalysis.verdict} />
              </div>
              <div
                className="rounded px-4 py-3"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line">
                  {currentAnalysis.analysis}
                </p>
                {currentAnalysis.references && currentAnalysis.references.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentAnalysis.references.map((url) => {
                      let label = url;
                      try {
                        label = new URL(url).hostname.replace('www.', '');
                      } catch (e) {
                        // Keep raw URL or fallback if parsing fails
                      }
                      return (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-accent transition-colors px-1.5 py-0.5 rounded-sm bg-white/5 hover:bg-white/8"
                        >
                          {label}
                          <ExternalLink size={8} strokeWidth={1.5} />
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const TAG_CHIP = "text-[10px] leading-none px-1.5 py-[3.9px] rounded-sm bg-white/8 text-white/35";
const LABEL_CLS = "text-[10px] uppercase tracking-widest text-white/50";

function AnnotationGroup({
  noteLabel,
  tagsLabel,
  description,
  tags,
}: {
  noteLabel: string;
  tagsLabel: string;
  description: string | null;
  tags: string[];
}) {
  const hasNote = !!description;
  const hasTags = tags.length > 0;

  return (
    <div className="space-y-2">
      {hasNote && (
        <div>
          <p className={`${LABEL_CLS} mb-1.5`}>{noteLabel}</p>
          <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line">{description}</p>
        </div>
      )}
      {hasTags && (
        <div>
          <p className={`${LABEL_CLS} mb-1.5`}>{tagsLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => <span key={t} className={TAG_CHIP}>{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}