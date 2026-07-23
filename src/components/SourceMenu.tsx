import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  Compass,
  Copy,
  Download,
  FileText,
  Globe,
  ImagePlus,
  LogOut,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { getSourceMode, isPublicMode, setSourceMode } from "../data/source";
import { AUTH_CHANGED_EVENT, getSessionUser, signOut } from "../data/googleAuth";
import {
  deleteGarden,
  getGardenSize,
  publicShareUrl,
  publishGarden,
  resetDrive,
  unpublishGarden,
  type GardenSize,
} from "../data/driveSource";
import {
  type GardenProfile,
  type PublishInfo,
  loadProfile,
  resetProfile,
  saveProfile,
  setPublished as savePublishedState,
  toAvatarDataUrl,
} from "../data/profile";
import { resetGardenDescription } from "../data/gardenDescription";
import { enrichGarden } from "../data/enrichment";
import { exportGarden } from "../data/exportGarden";
import AnalysisAIAssist from "./AnalysisAIAssist";
import { useAIFeaturesVisible } from "../hooks/useAIFeatures";
import { requestTour } from "./GardenTour";

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Header dropdown for switching between the static founder's garden and the
 * signed-in user's Drive-backed garden, plus session controls.
 */
export default function SourceMenu() {
  const [open, setOpen] = useState(false);
  const [, setAuthTick] = useState(0);
  const [busy, setBusy] = useState<null | string>(null);
  const [size, setSize] = useState<GardenSize | null>(null);
  const [profile, setProfile] = useState<GardenProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [published, setPublishedInfo] = useState<PublishInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPic, setDraftPic] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = getSourceMode();
  const user = getSessionUser();
  const aiVisible = useAIFeaturesVisible();

  const displayName = profile?.name || user?.name || "My garden";
  const avatar = profile?.picture || user?.picture || null;

  const avatarEl = (src: string | null, px: number) =>
    src ? (
      <img
        src={src}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: px, height: px }}
      />
    ) : (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-white/10 text-ink-muted"
        style={{ width: px, height: px }}
      >
        <UserRound size={Math.round(px * 0.55)} />
      </span>
    );

  const handleEnrich = async () => {
    setBusy("Enriching…");
    try {
      const { speciesUpdated, taxaAdded } = await enrichGarden((p) =>
        setBusy(`Enriching ${p.done}/${p.total}`),
      );
      setBusy(
        speciesUpdated || taxaAdded
          ? `Enriched ${speciesUpdated} species, ${taxaAdded} taxa`
          : "Everything already enriched",
      );
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Enrichment failed");
    } finally {
      setTimeout(() => setBusy(null), 2500);
    }
  };

  const handleExport = async () => {
    setBusy("Preparing backup…");
    try {
      await exportGarden((label, done, total) => setBusy(`${label} ${done}/${total}`));
      setBusy("Backup downloaded");
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setTimeout(() => setBusy(null), 2500);
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    setBusy("Deleting garden…");
    try {
      await deleteGarden();
      // No server-side data exists, so removing the Drive folder plus revoking
      // the token fully erases the account. Drop back to the founder's garden
      // (this reloads the app into a clean, signed-out state).
      signOut();
      setSourceMode("static");
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Delete failed");
      setTimeout(() => setBusy(null), 3000);
    }
  };

  useEffect(() => {
    // Sign-in/out/switch invalidates every cache tied to the old account. Drive
    // state (indexed folder/file IDs + the published-manifest flag) is keyed to
    // that account, so it must be dropped too — otherwise the next account, or a
    // re-sign-in in the same tab, reuses the previous account's file IDs.
    const bump = () => {
      resetDrive();
      resetProfile();
      resetGardenDescription();
      setProfile(null);
      setEditing(false);
      setAuthTick((t) => t + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, bump);
  }, []);

  // On open (Drive + signed in), load storage usage and the account profile.
  // Both reflect current Drive state; failures stay silent.
  useEffect(() => {
    if (!open || mode !== "drive" || !user) return;
    let cancelled = false;
    getGardenSize()
      .then((s) => !cancelled && setSize(s))
      .catch(() => {});
    loadProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, mode, user?.email]);

  // Published state drives an always-visible indicator, so load it on mount
  // (not only when the menu opens) whenever this is the user's Drive garden.
  useEffect(() => {
    if (mode !== "drive" || !user) {
      setPublishedInfo(null);
      return;
    }
    let cancelled = false;
    loadProfile()
      .then((p) => !cancelled && setPublishedInfo(p.published))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, user?.email]);

  const handlePublish = async () => {
    setConfirmingPublish(false);
    setBusy("Preparing photos…");
    try {
      const result = await publishGarden((done, total) =>
        total > 0 ? setBusy(`Preparing photos ${done}/${total}`) : setBusy("Publishing…"),
      );
      const info: PublishInfo = {
        manifestFileId: result.manifestFileId,
        permissionId: result.permissionId,
        publishedAt: new Date().toISOString(),
      };
      await savePublishedState(info);
      setPublishedInfo(info);
      setBusy(null);
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Publish failed");
      setTimeout(() => setBusy(null), 3000);
    }
  };

  const handleUnpublish = async () => {
    if (!published) return;
    setBusy("Stopping sharing…");
    try {
      await unpublishGarden(published.permissionId);
      await savePublishedState(null);
      setPublishedInfo(null);
      setBusy(null);
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Could not stop sharing");
      setTimeout(() => setBusy(null), 3000);
    }
  };

  const handleCopyLink = async () => {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(publicShareUrl(published.manifestFileId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is shown in full for manual copy.
    }
  };

  const startEditing = () => {
    setDraftName(profile?.name ?? "");
    setDraftPic(profile?.picture ?? null);
    setEditing(true);
  };

  const handlePickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    try {
      setDraftPic(await toAvatarDataUrl(file));
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Could not read image");
      setTimeout(() => setBusy(null), 2500);
    }
  };

  const handleToggleAI = async () => {
    const next = !(profile?.hideAI ?? false);
    setBusy(next ? "Hiding AI features…" : "Showing AI features…");
    try {
      setProfile(
        await saveProfile({
          name: profile?.name ?? null,
          picture: profile?.picture ?? null,
          hideAI: next,
        }),
      );
      setBusy(null);
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Save failed");
      setTimeout(() => setBusy(null), 2500);
    }
  };

  const handleSaveProfile = async () => {
    setBusy("Saving…");
    try {
      const saved = await saveProfile({
        name: draftName,
        picture: draftPic,
        hideAI: profile?.hideAI ?? false,
      });
      setProfile(saved);
      setEditing(false);
      setBusy(null);
    } catch (err) {
      setBusy(err instanceof Error ? err.message : "Save failed");
      setTimeout(() => setBusy(null), 2500);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const optionCls =
    "w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-white/5 transition-colors cursor-pointer";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center h-8 w-8 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
        title={published ? "Choose garden — currently shared publicly" : "Choose garden"}
        aria-label="Choose garden"
        aria-expanded={open}
      >
        <Cloud
          size={20}
          strokeWidth={1.5}
          className={mode === "drive" ? "text-accent" : undefined}
        />
        {published && (
          // Persistent reminder that this garden is public, visible without
          // opening the menu.
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-accent"
            title="This garden is shared publicly"
          >
            <Globe size={11} strokeWidth={2} />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-md border border-ink-faint/30 bg-surface shadow-xl py-1">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-ink-muted font-display">
            Garden
          </p>
          {isPublicMode() && (
            <>
              <div className="mx-3 mb-1 flex items-start gap-1.5 rounded bg-accent/10 px-2 py-1.5 text-[11px] leading-relaxed text-ink-muted">
                <Globe size={12} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
                <span>You're viewing a shared garden. Open your own below.</span>
              </div>
              <button className={optionCls} onClick={() => window.location.reload()}>
                <span className="w-4">
                  <RefreshCw size={13} />
                </span>
                Refresh for latest
              </button>
            </>
          )}
          <button className={optionCls} onClick={() => setSourceMode("static")}>
            <span className="w-4">{mode === "static" && <Check size={14} />}</span>
            Founder's garden (plantyj.com)
          </button>
          <button className={optionCls} onClick={() => setSourceMode("drive")}>
            <span className="w-4">{mode === "drive" && <Check size={14} />}</span>
            My garden (Google Drive)
          </button>
          {mode === "drive" && user && (
            <>
              <div className="my-1 border-t border-ink-faint/20" />
              <button className={optionCls} onClick={handleEnrich} disabled={busy !== null}>
                <span className="w-4">
                  <Sparkles size={13} />
                </span>
                Enrich my garden
              </button>
              {aiVisible && (
                <button
                  className={optionCls}
                  onClick={() => {
                    setOpen(false);
                    setAnalyzeOpen(true);
                  }}
                  disabled={busy !== null}
                >
                  <span className="w-4">
                    <FileText size={13} />
                  </span>
                  Draft analyses with a model
                </button>
              )}
              <button className={optionCls} onClick={handleExport} disabled={busy !== null}>
                <span className="w-4">
                  <Download size={13} />
                </span>
                Download backup (.zip)
              </button>
              <button
                className={optionCls}
                onClick={() => {
                  setOpen(false);
                  requestTour();
                }}
              >
                <span className="w-4">
                  <Compass size={13} />
                </span>
                Take the tour
              </button>
              <div className="my-1 border-t border-ink-faint/20" />
              {published ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-accent">
                    <Globe size={12} strokeWidth={1.75} />
                    <span className="font-display uppercase tracking-widest">Shared publicly</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                    Anyone with this link can browse your garden — no sign-in.
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      readOnly
                      value={publicShareUrl(published.manifestFileId)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded border border-ink-faint/30 bg-white/5 px-2 py-1 text-[11px] text-ink"
                    />
                    <button
                      onClick={handleCopyLink}
                      className="shrink-0 rounded p-1.5 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink"
                      title="Copy link"
                      aria-label="Copy link"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <button
                    onClick={handleUnpublish}
                    disabled={busy !== null}
                    className="mt-2 text-[11px] text-ink-muted transition-colors hover:text-red-300 disabled:opacity-50"
                  >
                    Stop sharing
                  </button>
                </div>
              ) : (
                <button
                  className={optionCls}
                  onClick={() => setConfirmingPublish(true)}
                  disabled={busy !== null}
                >
                  <span className="w-4">
                    <Globe size={13} />
                  </span>
                  Share publicly
                </button>
              )}
              {busy && (
                <p className="px-3 py-1 text-[11px] text-accent truncate" title={busy}>
                  {busy}
                </p>
              )}
              <div className="my-1 border-t border-ink-faint/20" />
              {editing ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="relative shrink-0 rounded-full"
                      title="Change photo"
                      aria-label="Change photo"
                    >
                      {avatarEl(draftPic, 40)}
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-surface">
                        <ImagePlus size={10} />
                      </span>
                    </button>
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder={user.name || "Garden name"}
                      maxLength={60}
                      autoFocus
                      className="min-w-0 flex-1 rounded border border-ink-faint/30 bg-white/5 px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {draftPic && (
                      <button
                        className="text-[11px] text-ink-muted hover:text-ink"
                        onClick={() => setDraftPic(null)}
                      >
                        Remove photo
                      </button>
                    )}
                    <div className="ml-auto flex gap-1.5">
                      <button
                        className="rounded px-2 py-1 text-[11px] text-ink-muted hover:bg-white/5 hover:text-ink"
                        onClick={() => setEditing(false)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </button>
                      <button
                        className="rounded bg-accent px-2 py-1 text-[11px] text-surface hover:opacity-90 disabled:opacity-50"
                        onClick={handleSaveProfile}
                        disabled={busy !== null}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handlePickPhoto}
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-3 py-2">
                    {avatarEl(avatar, 32)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink" title={displayName}>
                        {displayName}
                      </p>
                      {user.email && (
                        <p className="truncate text-[11px] text-ink-muted" title={user.email}>
                          {user.email}
                        </p>
                      )}
                    </div>
                    <button
                      className="shrink-0 rounded p-1 text-ink-muted transition-colors hover:bg-white/5 hover:text-ink"
                      onClick={startEditing}
                      title="Edit name & photo"
                      aria-label="Edit name & photo"
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                  {size && (
                    <p className="px-3 pb-1 text-[11px] text-ink-muted">
                      {formatBytes(size.bytes)} · {size.files} file{size.files === 1 ? "" : "s"}
                    </p>
                  )}
                </>
              )}
              <div className="my-1 border-t border-ink-faint/20" />
              <button
                className={optionCls}
                onClick={handleToggleAI}
                disabled={busy !== null}
                role="menuitemcheckbox"
                aria-checked={!aiVisible}
                title="Hide every model-assisted feature (prompt generation, drafting) from this account"
              >
                <span className="w-4">{!aiVisible && <Check size={14} />}</span>
                Hide AI features
              </button>
              <button
                className={`${optionCls} text-red-400 hover:text-red-300`}
                onClick={() => setConfirmingDelete(true)}
                disabled={busy !== null}
              >
                <span className="w-4">
                  <Trash2 size={13} />
                </span>
                Delete my garden
              </button>
              <button
                className={optionCls}
                onClick={() => {
                  signOut();
                  setOpen(false);
                }}
              >
                <span className="w-4">
                  <LogOut size={13} />
                </span>
                Sign out
              </button>
            </>
          )}
        </div>
      )}
      {confirmingDelete && (
        <DeleteGardenDialog
          busy={busy !== null}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
          onExport={handleExport}
        />
      )}
      {confirmingPublish && (
        <PublishGardenDialog
          busy={busy !== null}
          onCancel={() => setConfirmingPublish(false)}
          onConfirm={handlePublish}
        />
      )}
      {analyzeOpen && aiVisible && (
        <AnalysisAIAssist onClose={() => setAnalyzeOpen(false)} onApplied={() => {}} />
      )}
    </div>
  );
}

/**
 * Styled confirmation for the irreversible "delete my garden" action,
 * matching the site's modal treatment (backdrop, surface-raised card).
 */
function DeleteGardenDialog({
  busy,
  onCancel,
  onConfirm,
  onExport,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onExport: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Delete garden"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-ink-faint/25 bg-surface-raised p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-400">
            <AlertTriangle size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm tracking-tight text-ink">Delete your garden?</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              This permanently removes the entire PlantyJ folder from your Google Drive — every
              photo and all data — and revokes PlantyJ's access. It cannot be undone.
            </p>
            <button
              onClick={onExport}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-dim transition-colors disabled:opacity-50"
            >
              <Download size={12} strokeWidth={1.5} />
              Download a backup first
            </button>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs text-ink-muted hover:bg-white/5 hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500/90 px-3 py-1.5 text-xs font-display tracking-wide text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            <Trash2 size={13} strokeWidth={1.75} />
            {busy ? "Deleting…" : "Delete garden"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Consent gate for publishing a garden. States plainly and completely what
 * becomes public, that the link is unguessable-but-not-secret, and that it's
 * reversible — the disclosures the sharing plan requires before the switch flips.
 */
function PublishGardenDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share garden publicly"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-ink-faint/25 bg-surface-raised p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Globe size={16} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm tracking-tight text-ink">Share your garden?</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              You'll get a link anyone can open to browse your garden read-only — no Google
              account, no sign-in. Before you do:
            </p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-muted">
              <li>
                • <span className="text-ink">Everything becomes public</span> — all photos, notes,
                zones, species data, and your display name and avatar.
              </li>
              <li>
                • The folder is <span className="text-ink">browsable in Google Drive</span>, not
                only through PlantyJ.
              </li>
              <li>
                • The link is unguessable but <span className="text-ink">not secret</span> — anyone
                you send it to, and anyone they forward it to, has access.
              </li>
              <li>
                • It's <span className="text-ink">reversible anytime</span>; stopping takes effect
                immediately.
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs text-ink-muted hover:bg-white/5 hover:text-ink transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-display tracking-wide text-surface hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Globe size={13} strokeWidth={2} className="stroke-surface" />
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
