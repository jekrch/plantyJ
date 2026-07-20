import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Relationship, RelationshipDirection, RelationshipType } from "../../types";
import { effectiveDirection } from "../../hooks/useRelationships";
import { Dropdown, type DropdownOption } from "../Dropdown";
import { DirectionPicker, dirToStored, type DirChoice } from "../DirectionPicker";
import Modal from "./Modal";
import { LABEL } from "./styles";

/** Modal for retyping, reversing, or deleting an existing relationship. */
export default function EdgeEditor({
  rel,
  label,
  types,
  typeById,
  busy,
  onCancel,
  onDelete,
  onSave,
}: {
  rel: Relationship;
  label: (c: string) => string;
  types: RelationshipType[];
  typeById: Map<string, RelationshipType>;
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: (fields: { typeId?: string; direction?: RelationshipDirection }) => void;
}) {
  const [typeId, setTypeId] = useState(rel.type);
  const initialDir: DirChoice = rel.direction ?? "auto";
  const [dir, setDir] = useState<DirChoice>(initialDir);
  const [confirmDel, setConfirmDel] = useState(false);
  const directional = (typeById.get(typeId) ?? types.find((t) => t.id === typeId))?.directional ?? true;

  const typeOptions = useMemo<DropdownOption[]>(
    () => types.map((t) => ({ value: t.id, label: t.name, hint: t.directional ? "→" : "↔" })),
    [types],
  );

  return (
    <Modal onClose={onCancel} busy={busy} title="Edit relationship">
      <div className="flex items-center gap-2 rounded bg-white/3 border border-white/10 p-2.5 text-sm text-ink">
        <span className="truncate flex-1 text-right">{label(rel.from)}</span>
        <span className="text-ink-muted font-mono shrink-0">
          {effectiveDirection(rel, typeById.get(rel.type)) === "u" ? "↔" : "→"}
        </span>
        <span className="truncate flex-1">{label(rel.to)}</span>
      </div>

      <div>
        <label className={LABEL}>Type</label>
        <Dropdown value={typeId} options={typeOptions} onChange={setTypeId} disabled={busy} />
      </div>

      <div>
        <label className={LABEL}>Direction</label>
        <DirectionPicker value={dir} directional={directional} onChange={setDir} disabled={busy} />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}
          disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider transition-colors ${
            confirmDel
              ? "bg-rose-900/60 text-rose-200 hover:bg-rose-900/80"
              : "text-rose-300/80 hover:text-rose-300"
          }`}
        >
          <Trash2 size={13} /> {confirmDel ? "Really delete?" : "Delete"}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                typeId: typeId !== rel.type ? typeId : undefined,
                direction: dirToStored(dir),
              })
            }
            disabled={busy}
            className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
