import { useMemo, useState } from "react";
import { ArrowLeftRight, Check } from "lucide-react";
import type { RelationshipDirection, RelationshipType } from "../../types";
import { slugifyTypeId } from "../../data/relationshipMutations";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { DirectionPicker, dirToStored, type DirChoice } from "../DirectionPicker";
import Modal from "./Modal";
import { INPUT, LABEL } from "./styles";

export interface ComposerSubmit {
  typeId: string;
  direction?: RelationshipDirection;
  newType?: { id: string; name: string; description: string; directional: boolean };
}

/** Modal for turning a completed drag into a new relationship. */
export default function Composer({
  from,
  to,
  label,
  types,
  busy,
  onSwap,
  onCancel,
  onSubmit,
}: {
  from: string;
  to: string;
  label: (c: string) => string;
  types: RelationshipType[];
  busy: boolean;
  onSwap: () => void;
  onCancel: () => void;
  onSubmit: (s: ComposerSubmit) => void;
}) {
  const NEW = "__new__";
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? NEW);
  const [dir, setDir] = useState<DirChoice>("auto");
  const [newName, setNewName] = useState("");
  const [newDirectional, setNewDirectional] = useState(true);

  const creatingType = typeId === NEW || types.length === 0;
  const activeType = types.find((t) => t.id === typeId);
  const directional = creatingType ? newDirectional : activeType?.directional ?? true;

  const typeOptions = useMemo<DropdownOption[]>(
    () => [
      ...types.map((t) => ({ value: t.id, label: t.name, hint: t.directional ? "→" : "↔" })),
      { value: NEW, label: "＋ New type…" },
    ],
    [types],
  );

  const submit = () => {
    if (creatingType) {
      const id = slugifyTypeId(newName);
      onSubmit({
        typeId: id,
        direction: dirToStored(dir),
        newType: { id, name: newName, description: "", directional: newDirectional },
      });
    } else {
      onSubmit({ typeId, direction: dirToStored(dir) });
    }
  };

  return (
    <Modal onClose={onCancel} busy={busy} title="New relationship">
      <div className="flex items-center gap-2 rounded bg-white/3 border border-white/10 p-2.5">
        <span className="text-sm text-ink truncate flex-1 text-right">{label(from)}</span>
        <button
          onClick={onSwap}
          disabled={busy}
          title="Swap direction of endpoints"
          className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-white/5 transition-colors shrink-0"
        >
          <ArrowLeftRight size={14} />
        </button>
        <span className="text-sm text-ink truncate flex-1">{label(to)}</span>
      </div>

      <div>
        <label className={LABEL}>Type</label>
        {types.length > 0 && (
          <Dropdown value={typeId} options={typeOptions} onChange={setTypeId} disabled={busy} />
        )}
      </div>

      {creatingType && (
        <div className="space-y-2 rounded border border-white/10 bg-white/3 p-2.5">
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

      <div>
        <label className={LABEL}>Direction</label>
        <DirectionPicker value={dir} directional={directional} onChange={setDir} disabled={busy} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || (creatingType && !newName.trim())}
          className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          <Check size={13} /> Create link
        </button>
      </div>
    </Modal>
  );
}
