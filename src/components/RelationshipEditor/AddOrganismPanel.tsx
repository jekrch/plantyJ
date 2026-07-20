import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Organism } from "../../types";
import { imageSrc } from "../../data/source";

/** Search panel for pulling an organism that isn't on the canvas yet onto it. */
export default function AddOrganismPanel({
  allCodes,
  onCanvas,
  label,
  organismByCode,
  onAdd,
  onClose,
}: {
  allCodes: string[];
  onCanvas: Set<string>;
  label: (c: string) => string;
  organismByCode: Map<string, Organism>;
  onAdd: (code: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allCodes
      .filter((c) => !onCanvas.has(c))
      .filter((c) => !query || label(c).toLowerCase().includes(query) || c.toLowerCase().includes(query))
      .slice(0, 40);
  }, [allCodes, onCanvas, label, q]);

  return (
    <div className="rounded-md bg-surface-raised/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10">
        <Search size={12} className="text-ink-muted shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add organism to canvas…"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
          spellCheck={false}
        />
        <button onClick={onClose} className="text-ink-muted hover:text-ink shrink-0" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      <ul className="max-h-72 overflow-y-auto thin-scroll py-1">
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-[11px] text-ink-faint italic">
            {onCanvas.size >= allCodes.length ? "Everything's already on the canvas" : "No matches"}
          </li>
        ) : (
          matches.map((c) => (
            <li key={c}>
              <button
                onClick={() => onAdd(c)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
              >
                {organismByCode.get(c) ? (
                  <img
                    src={imageSrc(organismByCode.get(c)!.image, 80)}
                    alt=""
                    className="w-6 h-6 rounded object-cover ring-1 ring-white/10 shrink-0"
                  />
                ) : (
                  <span className="w-6 h-6 rounded bg-white/5 shrink-0" />
                )}
                <span className="text-xs text-ink truncate min-w-0">{label(c)}</span>
                <span className="ml-auto text-[9px] font-mono text-ink-faint shrink-0">{c}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
