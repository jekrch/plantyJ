import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import type { OrganismRecord, Zone } from "../types";
import { addEntries, type NewEntryInput } from "../data/mutations";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface Props {
  open: boolean;
  onClose: () => void;
  organismRecords: OrganismRecord[];
  zones: Zone[];
}

interface PendingFile {
  file: File;
  preview: string;
  description: string;
}

const NEW = "__new__";

const LABEL = "block text-[10px] uppercase tracking-widest text-ink-muted font-display mb-1";
const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";

/**
 * Drive-mode upload flow: pick photos, attach them to an existing or new
 * plant + zone, and commit everything to the user's Drive garden.
 */
export default function AddEntrySheet({ open, onClose, organismRecords, zones }: Props) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [plantChoice, setPlantChoice] = useState<string>(NEW);
  const [newShortCode, setNewShortCode] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newCommonName, setNewCommonName] = useState("");
  const [zoneChoice, setZoneChoice] = useState<string>(zones[0]?.code ?? NEW);
  const [newZoneCode, setNewZoneCode] = useState("");
  const [newZoneName, setNewZoneName] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Only mounted while open (see App), so the lock spans the sheet's lifetime.
  useBodyScrollLock(panelRef);

  // Object URLs live as long as the sheet; revoke them when it unmounts.
  useEffect(() => {
    return () => {
      for (const f of files) URL.revokeObjectURL(f.preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedPlants = useMemo(
    () =>
      [...organismRecords].sort((a, b) =>
        (a.commonName ?? a.shortCode).localeCompare(b.commonName ?? b.shortCode),
      ),
    [organismRecords],
  );

  if (!open) return null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ file: f, preview: URL.createObjectURL(f), description: "" }));
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const shortCode = plantChoice === NEW ? newShortCode.trim() : plantChoice;
  const zoneCode = zoneChoice === NEW ? newZoneCode.trim() : zoneChoice;
  const canSave = !saving && files.length > 0 && shortCode !== "" && zoneCode !== "";

  const handleSave = async () => {
    if (!canSave) return;
    if (plantChoice === NEW && organismRecords.some((p) => p.shortCode === shortCode)) {
      setError(`Plant code "${shortCode}" already exists — pick it from the list instead.`);
      return;
    }
    setSaving(true);
    setError(null);
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const inputs: NewEntryInput[] = files.map((f) => ({
      file: f.file,
      shortCode,
      newPlant:
        plantChoice === NEW
          ? {
              fullName: newFullName.trim() || null,
              commonName: newCommonName.trim() || null,
              variety: null,
            }
          : undefined,
      zoneCode,
      newZoneName: zoneChoice === NEW ? newZoneName.trim() || undefined : undefined,
      tags: tagList,
      description: f.description.trim() || null,
    }));
    try {
      await addEntries(inputs, (done, total) => setProgress(`Uploading ${done}/${total}…`));
      for (const f of files) URL.revokeObjectURL(f.preview);
      setFiles([]);
      setTags("");
      setProgress(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setProgress(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70"
      onClick={saving ? undefined : onClose}
    >
      <div
        ref={panelRef}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto thin-scroll info-modal-scroll bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink">Add photos</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Photo picker */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded border border-dashed border-white/15 hover:border-accent/40 py-4 text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer"
          >
            <ImagePlus size={16} strokeWidth={1.5} />
            {files.length === 0 ? "Choose photos" : "Add more photos"}
          </button>
          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {files.map((f, idx) => (
                <div key={f.preview} className="flex items-start gap-3">
                  <img
                    src={f.preview}
                    alt=""
                    className="w-14 h-14 rounded object-cover shrink-0 ring-1 ring-white/10"
                  />
                  <input
                    className={INPUT}
                    placeholder="Description (optional)"
                    value={f.description}
                    disabled={saving}
                    onChange={(e) =>
                      setFiles((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p)),
                      )
                    }
                  />
                  <button
                    onClick={() => removeFile(idx)}
                    disabled={saving}
                    className="mt-2 text-ink-muted hover:text-rose-300 transition-colors"
                    aria-label="Remove photo"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plant */}
        <div>
          <label className={LABEL}>Plant</label>
          <select
            className={INPUT}
            value={plantChoice}
            disabled={saving}
            onChange={(e) => setPlantChoice(e.target.value)}
          >
            <option value={NEW}>+ New plant…</option>
            {sortedPlants.map((p) => (
              <option key={p.shortCode} value={p.shortCode}>
                {p.commonName ?? p.fullName ?? p.shortCode} ({p.shortCode})
              </option>
            ))}
          </select>
          {plantChoice === NEW && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>Short code *</label>
                <input
                  className={INPUT}
                  placeholder="e.g. tmt-c"
                  value={newShortCode}
                  disabled={saving}
                  onChange={(e) => setNewShortCode(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL}>Common name</label>
                <input
                  className={INPUT}
                  placeholder="Cherokee Purple Tomato"
                  value={newCommonName}
                  disabled={saving}
                  onChange={(e) => setNewCommonName(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Scientific name</label>
                <input
                  className={INPUT}
                  placeholder="Solanum lycopersicum"
                  value={newFullName}
                  disabled={saving}
                  onChange={(e) => setNewFullName(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Zone */}
        <div>
          <label className={LABEL}>Zone</label>
          <select
            className={INPUT}
            value={zoneChoice}
            disabled={saving}
            onChange={(e) => setZoneChoice(e.target.value)}
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name ?? z.code} ({z.code})
              </option>
            ))}
            <option value={NEW}>+ New zone…</option>
          </select>
          {zoneChoice === NEW && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL}>Zone code *</label>
                <input
                  className={INPUT}
                  placeholder="e.g. fb1"
                  value={newZoneCode}
                  disabled={saving}
                  onChange={(e) => setNewZoneCode(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL}>Zone name</label>
                <input
                  className={INPUT}
                  placeholder="Front Bed 1"
                  value={newZoneName}
                  disabled={saving}
                  onChange={(e) => setNewZoneName(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className={LABEL}>Tags (comma-separated)</label>
          <input
            className={INPUT}
            placeholder="flowering, edible"
            value={tags}
            disabled={saving}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="flex items-center justify-end gap-3 pt-1">
          {progress && (
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              <LoaderCircle size={13} className="animate-spin" />
              {progress}
            </span>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Saving…" : `Save ${files.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
