import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Plant, Species, SpeciesTaxonomy, Zone } from "../types";

interface Props {
  open: boolean;
  plant: Plant;
  allPlants: Plant[];
  zones: Zone[];
  onSelectPlant: (plant: Plant) => void;
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

function slugifyFullName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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

const speciesCache = new Map<string, Species | null>();

export default function PlantInfoDrawer({
  open,
  plant,
  allPlants,
  zones,
  onSelectPlant,
  topOffset = 0,
  bottomOffset = 0,
  closing = false,
  slideDir = null,
}: Props) {
  const [species, setSpecies] = useState<Species | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);

  useEffect(() => {
    setDescExpanded(false);
    if (!plant.fullName) {
      setSpecies(null);
      return;
    }
    const slug = slugifyFullName(plant.fullName);
    if (speciesCache.has(slug)) {
      setSpecies(speciesCache.get(slug) ?? null);
      return;
    }
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/species/${slug}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Species>) : null))
      .catch(() => null)
      .then((data) => {
        speciesCache.set(slug, data);
        if (!cancelled) setSpecies(data);
      });
    return () => {
      cancelled = true;
    };
  }, [plant.fullName]);

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

  const taxonomyRows = useMemo(() => {
    if (!species?.taxonomy) return [] as Array<{ rank: string; name: string }>;
    return TAXONOMY_RANKS.flatMap((rank) => {
      const value = species.taxonomy?.[rank];
      if (!value) return [];
      return [{ rank, name: value as string }];
    });
  }, [species]);

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
        <div className="rounded px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Plant</p>
          <p className="font-display text-sm text-white/90 leading-snug">
            {plant.commonName ?? plant.fullName ?? plant.shortCode}{" "}
            <span className="text-accent">{plant.shortCode}</span>
          </p>
          {plant.fullName && plant.commonName && (
            <p className="text-[11px] text-white/50 italic mt-0.5">{plant.fullName}</p>
          )}
        </div>

        {/* Species overview */}
        {description && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">
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
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">
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
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">
              Classification
            </p>
            <ol className="space-y-1">
              {taxonomyRows.map((row, idx) => {
                const isLast = idx === taxonomyRows.length - 1;
                return (
                  <li
                    key={row.rank}
                    className="flex items-baseline gap-3 text-xs"
                    style={{ paddingLeft: `${idx * 10}px` }}
                  >
                    <span className="text-[9px] uppercase tracking-widest text-white/25 w-14 shrink-0 font-mono">
                      {row.rank}
                    </span>
                    <span
                      className={
                        isLast
                          ? "text-accent italic"
                          : "text-white/65"
                      }
                    >
                      {row.name}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Native range */}
        {species?.nativeRange && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">
              Native range
            </p>
            <p className="text-xs text-white/55 leading-relaxed">
              {species.nativeRange}
            </p>
          </div>
        )}

        {/* Zone */}
        <div className="rounded px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Zone</p>
          <p className="font-display text-sm text-white/90 leading-snug">
            {zoneNameByCode.get(plant.zoneCode) ?? plant.zoneCode}{" "}
            <span className="text-accent">{plant.zoneCode}</span>
          </p>
        </div>

        {/* Description */}
        {plant.description && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Notes</p>
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
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Tags</p>
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
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
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

        {/* Other plants sharing a zone */}
        {sharingZone.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-widest text-white/30">
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

        {/* Sources */}
        {species?.references && species.references.length > 0 && (
          <>
            <div className="border-t border-white/8" />
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">
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
