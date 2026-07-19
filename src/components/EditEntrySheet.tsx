import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import type { Organism, Zone, ZonePic } from "../types";
import { addZonePic, deleteEntry, deleteZonePic, updateEntry, updateZone } from "../data/mutations";
import { imageSrc } from "../data/source";
import { Dropdown } from "./Dropdown";

interface Props {
  organism: Organism;
  zones: Zone[];
  zonePics: ZonePic[];
  onClose: () => void;
  /** Called after a successful save or delete (the entry list has changed). */
  onChanged: () => void;
}

const LABEL = "block text-[10px] uppercase tracking-widest text-ink-muted font-display mb-1";
const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";

/** Drive-mode editor for a single journal entry (zone, tags, description). */
export default function EditEntrySheet({ organism, zones, zonePics, onClose, onChanged }: Props) {
  const [zoneCode, setZoneCode] = useState(organism.zoneCode);
  const [tags, setTags] = useState(organism.tags.join(", "));
  const [description, setDescription] = useState(organism.description ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedZone = zones.find((z) => z.code === zoneCode) ?? null;
  const [editingZone, setEditingZone] = useState(false);
  const [zoneName, setZoneName] = useState(selectedZone?.name ?? "");
  const [zoneDesc, setZoneDesc] = useState(selectedZone?.description ?? "");

  // Zone photo add/replace. Uploads run immediately (not deferred to Save) and
  // keep the sheet open so the refreshed image can render in place.
  const [zoneImgBusy, setZoneImgBusy] = useState(false);
  const zoneFileRef = useRef<HTMLInputElement>(null);
  // Newest-first: the leading pic for this zone is the one shown across the app.
  const currentZonePic = zonePics.find((z) => z.zoneCode === zoneCode) ?? null;
  const anyBusy = busy || zoneImgBusy;

  const handleZoneImage = (file: File) => {
    setZoneImgBusy(true);
    setError(null);
    addZonePic(zoneCode, file)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Upload failed"))
      .finally(() => setZoneImgBusy(false));
  };

  const handleRemoveZoneImage = () => {
    if (!currentZonePic) return;
    setZoneImgBusy(true);
    setError(null);
    deleteZonePic(currentZonePic.id)
      .then(onChanged)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Delete failed"))
      .finally(() => setZoneImgBusy(false));
  };

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
    run(async () => {
      // Persist zone renames/description edits first, then the entry itself.
      const zone = zones.find((z) => z.code === zoneCode);
      if (
        editingZone &&
        zone &&
        (zoneName !== (zone.name ?? "") || zoneDesc !== (zone.description ?? ""))
      ) {
        await updateZone(zoneCode, {
          name: zoneName.trim() || zoneCode,
          description: zoneDesc.trim() || null,
        });
      }
      await updateEntry(organism.id, {
        zoneCode,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description: description.trim() || null,
      });
    });

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
      onClick={anyBusy ? undefined : onClose}
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
          <div className="flex items-center justify-between mb-1">
            <label className={`${LABEL} mb-0`}>Zone</label>
            <button
              type="button"
              onClick={() => {
                const z = zones.find((zz) => zz.code === zoneCode);
                setZoneName(z?.name ?? "");
                setZoneDesc(z?.description ?? "");
                setEditingZone((v) => !v);
              }}
              disabled={busy}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent hover:text-accent-dim transition-colors cursor-pointer"
            >
              <Pencil size={10} strokeWidth={1.75} />
              {editingZone ? "Hide" : "Edit zone"}
            </button>
          </div>
          <Dropdown
            value={zoneCode}
            disabled={busy}
            onChange={(code) => {
              setZoneCode(code);
              if (editingZone) {
                const z = zones.find((zz) => zz.code === code);
                setZoneName(z?.name ?? "");
                setZoneDesc(z?.description ?? "");
              }
            }}
            options={zones.map((z) => ({
              value: z.code,
              label: z.name ?? z.code,
              hint: z.code,
            }))}
          />
          {editingZone && (
            <div className="mt-2 space-y-2 rounded border border-white/10 p-2.5">
              <div>
                <label className={LABEL}>Zone name</label>
                <input
                  className={INPUT}
                  value={zoneName}
                  disabled={busy}
                  onChange={(e) => setZoneName(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL}>Zone description</label>
                <textarea
                  className={`${INPUT} resize-none`}
                  rows={2}
                  value={zoneDesc}
                  disabled={busy}
                  onChange={(e) => setZoneDesc(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL}>Zone image</label>
                <div className="flex items-center gap-3">
                  <div className="relative w-14 h-14 shrink-0 rounded overflow-hidden ring-1 ring-white/10 bg-white/5">
                    {currentZonePic ? (
                      <img
                        src={imageSrc(currentZonePic.image, 200)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-ink-faint">
                        <ImagePlus size={16} strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => zoneFileRef.current?.click()}
                      disabled={anyBusy}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/20 hover:bg-accent/30 text-accent text-[11px] font-display uppercase tracking-wider transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      {zoneImgBusy ? (
                        <LoaderCircle size={12} className="animate-spin" />
                      ) : (
                        <ImagePlus size={12} strokeWidth={1.75} />
                      )}
                      {currentZonePic ? "New image" : "Add image"}
                    </button>
                    {currentZonePic && (
                      <button
                        type="button"
                        onClick={handleRemoveZoneImage}
                        disabled={anyBusy}
                        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300/80 hover:text-rose-300 transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        <Trash2 size={10} strokeWidth={1.75} />
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    ref={zoneFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) handleZoneImage(file);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
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
            disabled={anyBusy}
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
              disabled={anyBusy}
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
