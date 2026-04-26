import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ExternalLink, Sprout, Github } from "lucide-react";
import type { Plant, Zone, ZonePic } from "../types";
import { plantTitle } from "../utils/display";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

type Tab = "about" | "plants" | "zones";

interface Props {
  open: boolean;
  onClose: () => void;
  plants: Plant[];
  zones: Zone[];
  zonePics: ZonePic[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: "about", label: "About" },
  { id: "plants", label: "Plants" },
  { id: "zones", label: "Zones" },
];

export default function InfoModal(props: Props) {
  const { open } = props;
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  if (!mounted) return null;
  return <InfoModalContent {...props} visible={visible} />;
}

function InfoModalContent({
  onClose,
  plants,
  zones,
  zonePics,
  visible,
}: Props & { visible: boolean }) {
  const [tab, setTab] = useState<Tab>("about");
  const containerRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(containerRef);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const uniquePlants = useMemo(() => {
    const seen = new Map<string, Plant>();
    for (const p of plants) {
      if (!seen.has(p.shortCode)) seen.set(p.shortCode, p);
    }
    return Array.from(seen.values()).sort((a, b) => {
      const an = plantTitle(a).toLowerCase();
      const bn = plantTitle(b).toLowerCase();
      return an.localeCompare(bn);
    });
  }, [plants]);

  const zoneEntries = useMemo(() => {
    const picByZone = new Map<string, string>();
    for (const zp of zonePics) {
      if (!picByZone.has(zp.zoneCode)) picByZone.set(zp.zoneCode, zp.image);
    }
    const fallback = new Map<string, string>();
    for (const p of plants) {
      if (!fallback.has(p.zoneCode)) fallback.set(p.zoneCode, p.image);
    }
    return zones
      .map((z) => ({
        zone: z,
        image: picByZone.get(z.code) ?? fallback.get(z.code) ?? null,
      }))
      .sort((a, b) => (a.zone.name ?? a.zone.code).localeCompare(b.zone.name ?? b.zone.code));
  }, [zones, zonePics, plants]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Site information"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ease-out"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-2xl h-[min(640px,85vh)] flex flex-col rounded-lg border border-ink-faint/25 bg-surface-raised shadow-2xl shadow-black/50 overflow-hidden origin-center"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.96) translateY(4px)",
          transition:
            "opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-ink-faint/20">
          <div className="flex items-center gap-2">
            <Sprout size={16} strokeWidth={1.5} className="stroke-accent" />
            <h2 className="font-display text-sm tracking-tight text-ink">
              PlantyJ
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="flex items-center justify-center h-7 w-7 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Info sections"
          className="flex items-center gap-1 px-3 pt-2 border-b border-ink-faint/20"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`relative px-3 py-2 text-xs font-display tracking-wide transition-colors ${
                  active ? "text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
                <span
                  className={`absolute left-2 right-2 -bottom-px h-px transition-all duration-200 ease-out ${
                    active ? "bg-accent opacity-100" : "bg-transparent opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto info-modal-scroll">
          {tab === "about" && <AboutPanel />}
          {tab === "plants" && <PlantsPanel plants={uniquePlants} />}
          {tab === "zones" && <ZonesPanel entries={zoneEntries} />}
        </div>
      </div>
    </div>
  );
}

function AboutPanel() {
  return (
    <div className="px-6 py-6 space-y-5">
      <p className="text-sm text-ink leading-relaxed">
        PlantyJ is a visual catalog of the plants growing around our
        house. It includes pictures, identifications, and the zones where they live. Each
        photo is tagged with a short code; tap any image for taxonomy, species information, related
        photos, and zone neighbors.
      </p>

      <div className="border-t border-ink-faint/20" />

      <div>
        <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
          Tabs
        </p>
        <ul className="space-y-1.5 text-xs text-ink-muted leading-relaxed">
          <li>
            <span className="text-ink">Plants</span> — every plant with its short
            code and a reference photo.
          </li>
          <li>
            <span className="text-ink">Zones</span> — areas of the yard with a
            representative photo of each.
          </li>
        </ul>
      </div>

      <div className="border-t border-ink-faint/20" />

      <div>
        <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
          Links
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="https://jacobkrch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-accent transition-colors px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/8 border border-ink-faint/20"
          >
            <ExternalLink size={12} strokeWidth={1.5} />
            jacobkrch.com
          </a>
          <a
            href="https://github.com/jekrch/plantyJ"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-accent transition-colors px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/8 border border-ink-faint/20"
          >
            <Github size={12} strokeWidth={1.5} />
            github.com/jekrch/plantyJ
          </a>
        </div>
      </div>
    </div>
  );
}

function PlantsPanel({ plants }: { plants: Plant[] }) {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-3 px-1">
        Plants · {plants.length}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {plants.map((p) => (
          <div
            key={p.shortCode}
            className="group flex flex-col rounded-md overflow-hidden bg-white/3 ring-1 ring-inset ring-white/5"
          >
            <div className="relative aspect-square overflow-hidden bg-surface">
              <img
                src={`${base}${p.image}`}
                alt={plantTitle(p)}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </div>
            <div className="px-2.5 py-2 min-w-0">
              <p className="text-[11px] text-ink leading-tight truncate font-display">
                {plantTitle(p)}
              </p>
              <p className="text-[10px] text-accent mt-0.5 font-mono tracking-wide">
                {p.shortCode}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ZonesPanel({
  entries,
}: {
  entries: { zone: Zone; image: string | null }[];
}) {
  const base = import.meta.env.BASE_URL;
  return (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-3 px-1">
        Zones · {entries.length}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {entries.map(({ zone, image }) => (
          <div
            key={zone.code}
            className="group flex flex-col rounded-md overflow-hidden bg-white/3 ring-1 ring-inset ring-white/5"
          >
            <div className="relative aspect-square overflow-hidden bg-surface">
              {image ? (
                <img
                  src={`${base}${image}`}
                  alt={zone.name ?? zone.code}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-[10px] font-mono">
                  no image
                </div>
              )}
            </div>
            <div className="px-2.5 py-2 min-w-0">
              <p className="text-[11px] text-ink leading-tight truncate font-display capitalize">
                {zone.name ?? zone.code}
              </p>
              <p className="text-[10px] text-accent mt-0.5 font-mono tracking-wide">
                {zone.code}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
