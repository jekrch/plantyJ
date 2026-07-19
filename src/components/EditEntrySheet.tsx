import { useState } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import type { Organism, Zone } from "../types";
import { deleteEntry, updateEntry } from "../data/mutations";
import { imageSrc } from "../data/source";

interface Props {
  organism: Organism;
  zones: Zone[];
  onClose: () => void;
  /** Called after a successful save or delete (the entry list has changed). */
  onChanged: () => void;
}

const LABEL = "block text-[10px] uppercase tracking-widest text-ink-muted font-display mb-1";
const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";

/** Drive-mode editor for a single journal entry (zone, tags, description). */
export default function EditEntrySheet({ organism, zones, onClose, onChanged }: Props) {
  const [zoneCode, setZoneCode] = useState(organism.zoneCode);
  const [tags, setTags] = useState(organism.tags.join(", "));
  const [description, setDescription] = useState(organism.description ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        onChanged();
        onClose();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Save failed");
        setBusy(false);
      });
  };

  const handleSave = () =>
    run(() =>
      updateEntry(organism.id, {
        zoneCode,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description: description.trim() || null,
      }),
    );

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    run(() => deleteEntry(organism.id));
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/70"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink">Edit entry</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <img
            src={imageSrc(organism.image, 200)}
            alt=""
            className="w-12 h-12 rounded object-cover ring-1 ring-white/10"
          />
          <div className="text-xs text-ink-muted">
            <span className="text-ink">{organism.shortCode}</span> · added{" "}
            {new Date(organism.addedAt).toLocaleDateString()}
          </div>
        </div>

        <div>
          <label className={LABEL}>Zone</label>
          <select
            className={INPUT}
            value={zoneCode}
            disabled={busy}
            onChange={(e) => setZoneCode(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name ?? z.code} ({z.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL}>Tags (comma-separated)</label>
          <input
            className={INPUT}
            value={tags}
            disabled={busy}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL}>Description</label>
          <textarea
            className={`${INPUT} resize-none`}
            rows={3}
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleDelete}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider transition-colors cursor-pointer ${
              confirmDelete
                ? "bg-rose-900/60 text-rose-200 hover:bg-rose-900/80"
                : "text-rose-300/80 hover:text-rose-300"
            }`}
          >
            <Trash2 size={13} strokeWidth={1.5} />
            {confirmDelete ? "Really delete?" : "Delete"}
          </button>
          <div className="flex items-center gap-3">
            {busy && <LoaderCircle size={14} className="animate-spin text-ink-muted" />}
            <button
              onClick={handleSave}
              disabled={busy}
              className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40 cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
