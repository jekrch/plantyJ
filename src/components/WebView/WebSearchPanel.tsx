import { Search, X } from "lucide-react";
import type { PositionedNode } from "./layout";

export type SearchMatch = { node: PositionedNode; label: string; sublabel: string };

/** Type-ahead over the graph's nodes, with keyboard-driven highlight. */
export default function WebSearchPanel({
  searchQuery,
  setSearchQuery,
  searchHi,
  setSearchHi,
  matches,
  searchInputRef,
  closeSearch,
  selectNode,
  onKeyDown,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchHi: number;
  setSearchHi: (i: number) => void;
  matches: SearchMatch[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  closeSearch: () => void;
  selectNode: (node: PositionedNode) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="w-72 max-w-[80vw] rounded-md bg-surface-raised/95 backdrop-blur-sm ring-1 ring-inset ring-white/10 shadow-xl overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-ink-faint/15">
        <Search size={12} strokeWidth={1.5} className="text-ink-muted shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search species…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={closeSearch}
          className="flex items-center justify-center h-5 w-5 rounded text-ink-muted hover:text-ink hover:bg-white/5 transition-colors shrink-0"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
      {searchQuery.trim() && (
        <ul className="max-h-72 overflow-y-auto thin-scroll py-1">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-faint italic">No matches</li>
          ) : (
            matches.map((m, i) => (
              <li key={`wsr-${m.node.code}-${i}`}>
                <button
                  type="button"
                  onMouseEnter={() => setSearchHi(i)}
                  onClick={() => selectNode(m.node)}
                  className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 transition-colors ${
                    i === searchHi ? "bg-white/8" : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-[12px] text-ink truncate min-w-0">{m.label}</span>
                  <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-ink-faint shrink-0">
                    {m.sublabel}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
