import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional code/hint shown right-aligned in accent mono, e.g. a short code. */
  hint?: string;
}

/**
 * App-styled select. Uses the same fully-themed popup as the view-mode / filter
 * dropdowns (accent active state, dot marker, mono hints) instead of a native
 * <select>, whose OS-drawn menu can't be themed to match the surface.
 *
 * The trigger deliberately mirrors the sheet's text-input styling so it lines
 * up with adjacent fields; the popup mirrors the app's dropdown menus.
 */
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Select…",
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className={`truncate ${current ? "" : "text-ink-faint"}`}>
          {current ? (
            <>
              {current.label}
              {current.hint && (
                <span className="text-accent/70 text-xs font-mono ml-1.5">{current.hint}</span>
              )}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`text-ink-faint shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto thin-scroll rounded-md bg-surface-raised ring-1 ring-inset ring-white/10 shadow-lg shadow-black/40 py-1">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-left text-sm transition-colors ${
                  active ? "text-accent bg-accent/5" : "text-ink-muted hover:text-ink hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {active && (
                    <span className="inline-block w-1 h-1 rounded-full bg-accent shrink-0" />
                  )}
                  <span className="truncate">{opt.label}</span>
                </span>
                {opt.hint && (
                  <span className="text-[10px] font-mono text-accent/70 shrink-0">{opt.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
