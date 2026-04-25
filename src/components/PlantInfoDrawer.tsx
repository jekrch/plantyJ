import { useMemo } from "react";
import type { Plant, Zone } from "../types";

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
  const samePlantTimeline = allPlants
    .filter((p) => p.shortCode === plant.shortCode && p.id !== plant.id)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  const zoneNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zones) if (z.name) m.set(z.code, z.name);
    return m;
  }, [zones]);

  const zoneSet = useMemo(() => new Set(plant.zoneCodes), [plant.zoneCodes]);
  const sharingZone = allPlants
    .filter(
      (p) =>
        p.shortCode !== plant.shortCode &&
        p.zoneCodes.some((z) => zoneSet.has(z))
    )
    .reduce<Plant[]>((acc, p) => {
      if (!acc.some((existing) => existing.shortCode === p.shortCode)) acc.push(p);
      return acc;
    }, []);

  const sharingHeader =
    plant.zoneCodes.length === 1
      ? `Others in ${zoneNameByCode.get(plant.zoneCodes[0]) ?? plant.zoneCodes[0]}`
      : "Others sharing a zone";

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

        {/* Zones */}
        <div className="rounded px-4 py-3" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">
            {plant.zoneCodes.length > 1 ? "Zones" : "Zone"}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {plant.zoneCodes.map((code) => (
              <p key={code} className="font-display text-sm text-white/90 leading-snug">
                {zoneNameByCode.get(code) ?? code}{" "}
                <span className="text-accent">{code}</span>
              </p>
            ))}
          </div>
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
      </div>
    </div>
  );
}
