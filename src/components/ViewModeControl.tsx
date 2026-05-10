import {
  useMemo,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import type { Plant, PlantRecord, Zone } from "../types";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Sprout,
  Map as MapIcon,
  TreeDeciduous,
} from "lucide-react";

export type ViewMode = "gallery" | "plant" | "zone" | "tree";

interface Props {
  mode: ViewMode;
  subjectCode: string | null;
  plants: Plant[];
  plantRecords: PlantRecord[];
  zones: Zone[];
  onChange: (mode: ViewMode, subjectCode: string | null) => void;
}

interface Option {
  code: string;
  label: string;
  count: number;
}

export default function ViewModeControl({
  mode,
  subjectCode,
  plants,
  plantRecords,
  zones,
  onChange,
}: Props) {
  const plantOptions = useMemo<Option[]>(() => {
    const countByCode = new Map<string, number>();
    const animalCodes = new Set<string>();
    for (const p of plants) {
      if (p.kind === "animal") {
        animalCodes.add(p.shortCode);
      } else {
        countByCode.set(p.shortCode, (countByCode.get(p.shortCode) ?? 0) + 1);
      }
    }
    const recordByCode = new Map<string, PlantRecord>();
    for (const r of plantRecords) recordByCode.set(r.shortCode, r);
    const codes = new Set<string>([
      ...plantRecords.map((r) => r.shortCode),
      ...plants.map((p) => p.shortCode),
    ]);
    return Array.from(codes)
      .filter((code) => !animalCodes.has(code))
      .map((code) => {
        const rec = recordByCode.get(code);
        const label = rec?.commonName ?? rec?.fullName ?? code;
        return {
          code,
          label,
          count: countByCode.get(code) ?? 0,
        };
      })
      .filter((o) => o.count > 0)
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [plants, plantRecords]);

  const zoneOptions = useMemo<Option[]>(() => {
    const countByZone = new Map<string, number>();
    for (const p of plants) {
      countByZone.set(p.zoneCode, (countByZone.get(p.zoneCode) ?? 0) + 1);
    }
    return zones
      .map((z) => ({
        code: z.code,
        label: z.name ?? z.code,
        count: countByZone.get(z.code) ?? 0,
      }))
      .filter((o) => o.count > 0)
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [zones, plants]);

  const setMode = (next: ViewMode) => {
    if (next === "gallery" || next === "tree") {
      onChange(next, null);
      return;
    }
    const options = next === "plant" ? plantOptions : zoneOptions;
    const keep =
      subjectCode && options.some((o) => o.code === subjectCode)
        ? subjectCode
        : options[0]?.code ?? null;
    onChange(next, keep);
  };

  const hasSubject = mode === "plant" || mode === "zone";
  const activeOptions =
    mode === "plant" ? plantOptions : mode === "zone" ? zoneOptions : [];
  const activeOption =
    hasSubject && subjectCode
      ? activeOptions.find((o) => o.code === subjectCode)
      : null;

  const segments: { key: ViewMode; label: string; Icon: typeof LayoutGrid }[] =
    [
      { key: "gallery", label: "Wall", Icon: LayoutGrid },
      { key: "plant", label: "Plant", Icon: Sprout },
      { key: "zone", label: "Zone", Icon: MapIcon },
      { key: "tree", label: "Tree", Icon: TreeDeciduous },
    ];

  return (
    <div className="view-mode-control flex flex-col items-center px-1">
      <SegmentedControl
        segments={segments}
        active={mode}
        onSelect={(next) => setMode(next)}
      />

      {hasSubject && (
        <div className="mt-4 self-center -mb-3">
          <SubjectPicker
            mode={mode as "plant" | "zone"}
            options={activeOptions}
            value={subjectCode}
            activeLabel={activeOption?.label ?? subjectCode ?? "Select"}
            capitalize={mode === "zone"}
            onChange={(code) => onChange(mode, code)}
          />
        </div>
      )}
    </div>
  );
}

function SubjectPicker({
  mode,
  options,
  value,
  activeLabel,
  capitalize,
  onChange,
}: {
  mode: Exclude<ViewMode, "gallery">;
  options: Option[];
  value: string | null;
  activeLabel: string;
  capitalize: boolean;
  onChange: (code: string) => void;
}) {
  const currentIndex = value
    ? options.findIndex((o) => o.code === value)
    : -1;
  const canStep = options.length > 1;

  const step = (delta: number) => {
    if (!canStep) return;
    const base = currentIndex >= 0 ? currentIndex : 0;
    const next = (base + delta + options.length) % options.length;
    onChange(options[next].code);
  };

  return (
    <div className="flex items-center gap-1.5">
      <ArrowBtn
        direction="prev"
        enabled={canStep}
        onClick={() => step(-1)}
      />
      <SubjectDropdown
        mode={mode}
        options={options}
        value={value}
        activeLabel={activeLabel}
        capitalize={capitalize}
        onChange={onChange}
      />
      <ArrowBtn
        direction="next"
        enabled={canStep}
        onClick={() => step(1)}
      />
    </div>
  );
}

function ArrowBtn({
  direction,
  enabled,
  onClick,
}: {
  direction: "prev" | "next";
  enabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      className={`flex items-center justify-center h-9 w-9 rounded-md bg-surface-raised ring-1 ring-inset ring-white/5 transition-all ${
        enabled
          ? "text-ink-muted hover:text-accent hover:ring-accent/40 active:scale-95"
          : "text-ink-faint/30 cursor-not-allowed"
      }`}
    >
      <Icon size={16} strokeWidth={1.5} />
    </button>
  );
}

let hasMountedBefore = false;

function SegmentedControl({
  segments,
  active,
  onSelect,
}: {
  segments: { key: ViewMode; label: string; Icon: typeof LayoutGrid }[];
  active: ViewMode;
  onSelect: (next: ViewMode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const [hasMeasured, setHasMeasured] = useState(false);
  const [visible, setVisible] = useState(!hasMountedBefore);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current[active];
      const container = containerRef.current;
      if (!btn || !container) return;
      const cRect = container.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      setIndicator({ left: bRect.left - cRect.left, width: bRect.width });
      setHasMeasured(true);
    };
    measure();
    window.addEventListener("resize", measure);
    const container = containerRef.current;
    let ro: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(container);
      Object.values(btnRefs.current).forEach((el) => {
        if (el) ro!.observe(el);
      });
    }
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [active]);

  useEffect(() => {
    if (!hasMeasured) return;
    if (!hasMountedBefore) {
      hasMountedBefore = true;
      return;
    }
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [hasMeasured]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-end gap-1 border-b border-white/[0.06] pb-0"
    >
      {segments.map(({ key, label, Icon }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            ref={(el) => {
              btnRefs.current[key] = el;
            }}
            type="button"
            onClick={() => onSelect(key)}
            className={`group relative flex items-center gap-2 px-4 py-2.5 font-display text-[11px] tracking-[0.18em] uppercase transition-colors duration-200 ${
              isActive
                ? "text-accent"
                : "text-ink-muted/70 hover:text-ink"
            }`}
          >
            <Icon
              size={13}
              strokeWidth={1.5}
              className={`transition-all duration-300 ${
                isActive
                  ? "scale-105"
                  : "opacity-70 group-hover:opacity-100"
              }`}
            />
            <span>{label}</span>
          </button>
        );
      })}
      {indicator && (
        <span
          aria-hidden
          className="absolute -bottom-px h-[1.5px] bg-accent/80 pointer-events-none rounded-full"
          style={{
            left: indicator.left,
            width: indicator.width,
            opacity: visible ? 1 : 0,
            transition: hasMeasured
              ? "left 320ms cubic-bezier(0.22, 1, 0.36, 1), width 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease-out"
              : "opacity 280ms ease-out",
          }}
        />
      )}
    </div>
  );
}

function SubjectDropdown({
  mode,
  options,
  value,
  activeLabel,
  capitalize,
  onChange,
}: {
  mode: Exclude<ViewMode, "gallery">;
  options: Option[];
  value: string | null;
  activeLabel: string;
  capitalize: boolean;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ModeIcon = mode === "plant" ? Sprout : MapIcon;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 px-3 h-9 rounded-md bg-surface-raised ring-1 ring-inset ring-white/5 hover:ring-accent/40 transition-all text-xs font-display tracking-wide text-ink min-w-56 sm:min-w-64"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ModeIcon
            size={13}
            strokeWidth={1.5}
            className="text-accent shrink-0"
          />
          <span className={`truncate ${capitalize ? "capitalize" : ""}`}>
            {activeLabel}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-ink-faint transition-transform shrink-0 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 left-0 right-0 sm:right-auto sm:min-w-full max-h-[60vh] overflow-y-auto thin-scroll rounded-md bg-surface-raised ring-1 ring-inset ring-white/10 shadow-lg shadow-black/40 py-1">
          {options.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-ink-faint">
              No options
            </div>
          )}
          {options.map((opt) => {
            const active = opt.code === value;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  onChange(opt.code);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[11px] transition-colors ${
                  active
                    ? "text-accent bg-accent/5"
                    : "text-ink-muted hover:text-ink hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {active && (
                    <span className="inline-block w-1 h-1 rounded-full bg-accent shrink-0" />
                  )}
                  <span
                    className={`truncate font-display ${
                      capitalize ? "capitalize" : ""
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="text-accent/70 text-[10px] font-mono shrink-0">
                    {opt.code}
                  </span>
                </span>
                <span className="text-[10px] font-mono text-ink-faint shrink-0">
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
