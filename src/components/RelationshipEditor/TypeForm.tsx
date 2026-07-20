import { useState } from "react";
import type { RelationshipType } from "../../types";
import { slugifyTypeId } from "../../data/relationshipMutations";
import { INPUT, LABEL } from "./styles";

/** Create / edit form for a relationship type. */
export default function TypeForm({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial?: RelationshipType;
  onSubmit: (t: { id: string; name: string; description: string; directional: boolean }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [directional, setDirectional] = useState(initial?.directional ?? true);
  const [description, setDescription] = useState(initial?.description ?? "");
  const id = editing ? initial!.id : slugifyTypeId(name);

  return (
    <div className="space-y-2.5 rounded border border-white/10 bg-white/3 p-3">
      <div>
        <label className={LABEL}>Type name</label>
        <input
          className={INPUT}
          autoFocus
          value={name}
          disabled={busy}
          placeholder="e.g. Pollinates, Companion"
          onChange={(e) => setName(e.target.value)}
        />
        {name.trim() && (
          <p className="mt-1 text-[10px] font-mono text-ink-faint">id: {id}</p>
        )}
      </div>
      <div>
        <label className={LABEL}>Description (optional)</label>
        <input
          className={INPUT}
          value={description}
          disabled={busy}
          placeholder="Shown in the legend tooltip"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none">
        <input
          type="checkbox"
          checked={directional}
          disabled={busy}
          onChange={(e) => setDirectional(e.target.checked)}
          className="accent-accent"
        />
        Directional (draws an arrow from → to)
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => onSubmit({ id, name, description, directional })}
          className="px-3 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
        >
          {editing ? "Save type" : "Add type"}
        </button>
      </div>
    </div>
  );
}
