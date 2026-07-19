import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type {
  Organism,
  Relationship,
  RelationshipDirection,
  RelationshipType,
} from "../types";
import { imageSrc } from "../data/source";
import { slugifyTypeId } from "../data/relationshipMutations";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { DirectionPicker, dirToStored, type DirChoice } from "./DirectionPicker";

/**
 * List-driven alternative to drag-to-connect. Dragging is fine when the canvas
 * is small, but a mature garden has too many nodes to hunt through — here you
 * pick the relationship type once, pick one anchor organism, then tick every
 * organism it connects to and create the whole fan-out in one write.
 */

const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";
const LABEL = "block text-[10px] uppercase tracking-widest text-ink-muted font-display mb-1";

const NEW_TYPE = "__new__";

export interface BulkConnectSubmit {
  typeId: string;
  source: string;
  targets: string[];
  direction?: RelationshipDirection;
  newType?: { id: string; name: string; description: string; directional: boolean };
}

/**
 * Mirrors `isDuplicate` in relationshipMutations so the list can grey out pairs
 * that would be rejected, rather than letting the user tick them and collecting
 * a pile of "already exists" errors on submit.
 */
function alreadyLinked(
  rels: Relationship[],
  typeId: string,
  from: string,
  to: string,
  direction: RelationshipDirection | undefined,
  directional: boolean,
): boolean {
  return rels.some((r) => {
    if (r.type !== typeId) return false;
    if (directional && (direction ?? "f") !== "u") return r.from === from && r.to === to;
    return (r.from === from && r.to === to) || (r.from === to && r.to === from);
  });
}

export default function BulkConnectSheet({
  allCodes,
  label,
  organismByCode,
  types,
  relationships,
  initialSource,
  busy,
  onCancel,
  onSubmit,
}: {
  allCodes: string[];
  label: (c: string) => string;
  organismByCode: Map<string, Organism>;
  types: RelationshipType[];
  relationships: Relationship[];
  initialSource?: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (s: BulkConnectSubmit) => void;
}) {
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? NEW_TYPE);
  const [newName, setNewName] = useState("");
  const [newDirectional, setNewDirectional] = useState(true);
  const [dir, setDir] = useState<DirChoice>("auto");
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [targets, setTargets] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");

  const creatingType = typeId === NEW_TYPE || types.length === 0;
  const activeType = types.find((t) => t.id === typeId);
  const directional = creatingType ? newDirectional : activeType?.directional ?? true;

  const typeOptions = useMemo<DropdownOption[]>(
    () => [
      ...types.map((t) => ({ value: t.id, label: t.name, hint: t.directional ? "→" : "↔" })),
      { value: NEW_TYPE, label: "＋ New type…" },
    ],
    [types],
  );

  // Pairs that would be rejected as duplicates, for the current type+direction.
  const linked = useMemo(() => {
    const s = new Set<string>();
    if (!source || creatingType) return s;
    const stored = dirToStored(dir);
    for (const c of allCodes) {
      if (alreadyLinked(relationships, typeId, source, c, stored, directional)) s.add(c);
    }
    return s;
  }, [allCodes, relationships, source, typeId, dir, directional, creatingType]);

  // Dropping a duplicate from the selection keeps the count honest when the
  // user changes type or direction after ticking things.
  useEffect(() => {
    setTargets((prev) => {
      const next = new Set([...prev].filter((c) => !linked.has(c) && c !== source));
      return next.size === prev.size ? prev : next;
    });
  }, [linked, source]);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allCodes.filter(
      (c) =>
        c !== source &&
        (!query || label(c).toLowerCase().includes(query) || c.toLowerCase().includes(query)),
    );
  }, [allCodes, source, label, q]);

  const selectableMatches = useMemo(
    () => matches.filter((c) => !linked.has(c)),
    [matches, linked],
  );
  const allMatchesSelected =
    selectableMatches.length > 0 && selectableMatches.every((c) => targets.has(c));

  const toggle = (code: string) =>
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const toggleAllMatches = () =>
    setTargets((prev) => {
      const next = new Set(prev);
      if (allMatchesSelected) for (const c of selectableMatches) next.delete(c);
      else for (const c of selectableMatches) next.add(c);
      return next;
    });

  const submit = () => {
    if (!source || targets.size === 0) return;
    const list = [...targets];
    const direction = dirToStored(dir);
    if (creatingType) {
      const id = slugifyTypeId(newName);
      onSubmit({
        typeId: id,
        source,
        targets: list,
        direction,
        newType: { id, name: newName, description: "", directional: newDirectional },
      });
    } else {
      onSubmit({ typeId, source, targets: list, direction });
    }
  };

  const canSubmit =
    !busy && !!source && targets.size > 0 && (!creatingType || !!newName.trim());

  return (
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-black/70"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink">Connect many</h2>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-5 space-y-4">
          {/* 1 — relationship type */}
          <div>
            <label className={LABEL}>Relationship</label>
            {types.length > 0 && (
              <Dropdown value={typeId} options={typeOptions} onChange={setTypeId} disabled={busy} />
            )}
            {creatingType && (
              <div className="space-y-2 rounded border border-white/10 bg-white/3 p-2.5 mt-2">
                <input
                  className={INPUT}
                  autoFocus
                  value={newName}
                  disabled={busy}
                  placeholder="New type name (e.g. Pollinates)"
                  onChange={(e) => setNewName(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newDirectional}
                    disabled={busy}
                    onChange={(e) => setNewDirectional(e.target.checked)}
                    className="accent-accent"
                  />
                  Directional
                </label>
              </div>
            )}
          </div>

          {/* 2 — the anchor organism */}
          <div>
            <label className={LABEL}>From</label>
            {source ? (
              <div className="flex items-center gap-2 rounded bg-white/3 border border-white/10 p-2">
                <Thumb code={source} organismByCode={organismByCode} />
                <span className="text-sm text-ink truncate min-w-0 flex-1">{label(source)}</span>
                <button
                  onClick={() => setSource(null)}
                  disabled={busy}
                  className="shrink-0 text-[10px] uppercase tracking-widest font-display text-ink-muted hover:text-ink transition-colors px-1.5"
                >
                  Change
                </button>
              </div>
            ) : (
              <CodePicker
                codes={allCodes}
                label={label}
                organismByCode={organismByCode}
                placeholder="Search for the organism to connect from…"
                onPick={setSource}
              />
            )}
          </div>

          {/* 3 — everything it connects to */}
          {source && (
            <>
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className={LABEL}>
                    To {targets.size > 0 && <span className="text-accent">· {targets.size}</span>}
                  </label>
                  {selectableMatches.length > 0 && (
                    <button
                      onClick={toggleAllMatches}
                      disabled={busy}
                      className="text-[10px] uppercase tracking-widest font-display text-ink-muted hover:text-ink transition-colors"
                    >
                      {allMatchesSelected ? "Clear" : `Select ${selectableMatches.length}`}
                    </button>
                  )}
                </div>
                <div className="rounded border border-white/10 overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10 bg-white/3">
                    <Search size={12} className="text-ink-muted shrink-0" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Filter organisms…"
                      className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
                      spellCheck={false}
                    />
                    {q && (
                      <button
                        onClick={() => setQ("")}
                        className="text-ink-muted hover:text-ink shrink-0"
                        aria-label="Clear filter"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <ul className="max-h-56 overflow-y-auto thin-scroll py-1">
                    {matches.length === 0 ? (
                      <li className="px-3 py-2 text-[11px] text-ink-faint italic">No matches</li>
                    ) : (
                      matches.map((c) => {
                        const isLinked = linked.has(c);
                        const checked = targets.has(c);
                        return (
                          <li key={c}>
                            <button
                              onClick={() => !isLinked && toggle(c)}
                              disabled={busy || isLinked}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                                isLinked ? "opacity-40 cursor-default" : "hover:bg-white/5"
                              }`}
                            >
                              <span
                                className={`shrink-0 w-4 h-4 rounded-sm border flex items-center justify-center ${
                                  checked
                                    ? "bg-accent/25 border-accent/60 text-accent"
                                    : "border-white/20"
                                }`}
                              >
                                {checked && <Check size={11} strokeWidth={3} />}
                              </span>
                              <Thumb code={c} organismByCode={organismByCode} />
                              <span className="text-xs text-ink truncate min-w-0">{label(c)}</span>
                              <span className="ml-auto text-[9px] font-mono text-ink-faint shrink-0">
                                {isLinked ? "linked" : c}
                              </span>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </div>

              <div>
                <label className={LABEL}>Direction</label>
                <DirectionPicker
                  value={dir}
                  directional={directional}
                  onChange={setDir}
                  disabled={busy}
                />
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  {dir === "b"
                    ? `Each selection → ${label(source)}`
                    : dir === "u" || (dir === "auto" && !directional)
                      ? `${label(source)} ↔ each selection`
                      : `${label(source)} → each selection`}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 border-t border-white/10">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            <Check size={13} />
            {targets.size > 1 ? `Create ${targets.size} links` : "Create link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Thumb({
  code,
  organismByCode,
}: {
  code: string;
  organismByCode: Map<string, Organism>;
}) {
  const o = organismByCode.get(code);
  return o ? (
    <img
      src={imageSrc(o.image, 80)}
      alt=""
      className="w-6 h-6 rounded object-cover ring-1 ring-white/10 shrink-0"
    />
  ) : (
    <span className="w-6 h-6 rounded bg-white/5 shrink-0" />
  );
}

/** Searchable single-select over organism codes. */
function CodePicker({
  codes,
  label,
  organismByCode,
  placeholder,
  onPick,
}: {
  codes: string[];
  label: (c: string) => string;
  organismByCode: Map<string, Organism>;
  placeholder: string;
  onPick: (code: string) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return codes
      .filter(
        (c) => !query || label(c).toLowerCase().includes(query) || c.toLowerCase().includes(query),
      )
      .slice(0, 40);
  }, [codes, label, q]);

  return (
    <div className="rounded border border-white/10 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10 bg-white/3">
        <Search size={12} className="text-ink-muted shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent text-[12px] text-ink placeholder:text-ink-faint outline-none"
          spellCheck={false}
        />
      </div>
      <ul className="max-h-48 overflow-y-auto thin-scroll py-1">
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-[11px] text-ink-faint italic">No matches</li>
        ) : (
          matches.map((c) => (
            <li key={c}>
              <button
                onClick={() => onPick(c)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
              >
                <Thumb code={c} organismByCode={organismByCode} />
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
