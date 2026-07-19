import { useState } from "react";
import { CloudOff, EyeOff, HardDrive, LoaderCircle, Lock, Monitor } from "lucide-react";
import { signIn } from "../data/googleAuth";
import { setSourceMode } from "../data/source";

export function SpinnerState() {
  return (
    <div className="flex items-center justify-center py-32">
      <LoaderCircle className="animate-spin h-8 w-8 text-ink-muted" />
    </div>
  );
}

export function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">Couldn't load the gallery.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

export function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      {onAdd ? (
        <>
          <p className="text-ink-muted text-sm">Your garden is empty.</p>
          <button
            onClick={onAdd}
            className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors font-display tracking-wider uppercase cursor-pointer"
          >
            Add your first plant
          </button>
        </>
      ) : (
        <p className="text-ink-muted text-sm">
          No organisms yet. Send a photo to the Telegram bot to get started.
        </p>
      )}
    </div>
  );
}

/**
 * Shown in Drive mode when there is no (or an expired) Google session.
 * Signing in re-triggers the data load via the auth-changed event.
 */
export function SignInState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    setBusy(true);
    setError(null);
    signIn()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col items-center justify-center py-32 text-center px-6">
      <CloudOff size={28} strokeWidth={1.25} className="text-ink-muted mb-4" />
      <p className="text-ink text-sm font-display">Your garden, in your Google Drive</p>
      <ul className="text-ink-muted text-xs mt-4 max-w-xs text-left leading-relaxed space-y-3">
        <li className="flex gap-2.5">
          <HardDrive size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            Build your journal using your own Google Drive for storage. Everything is saved to and
            read from a <span className="text-ink">PlantyJ</span> folder in your Drive. Nothing is
            stored on our servers.
          </span>
        </li>
        <li className="flex gap-2.5">
          <Monitor size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            The site can only reach that data while you're signed in, and it only ever shows up in
            your browser. We don't collect it or use it for anything else.
          </span>
        </li>
        <li className="flex gap-2.5">
          <Lock size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            Google only lets the site touch the files it creates. It can't see anything else in your
            Drive.
          </span>
        </li>
        <li className="flex gap-2.5">
          <EyeOff size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-muted" />
          <span>
            No one else can see your journal. You'll only see your garden when you're signed in.
          </span>
        </li>
      </ul>
      <button
        onClick={handleSignIn}
        disabled={busy}
        className="mt-6 px-4 py-2 rounded-md bg-white/10 hover:bg-white/15 text-ink text-sm font-display tracking-wide transition-colors disabled:opacity-50 cursor-pointer"
      >
        {busy ? "Signing in…" : "Sign in with Google"}
      </button>
      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      <button
        onClick={() => setSourceMode("static")}
        className="mt-4 text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer"
      >
        ← Back to the founder's garden
      </button>
    </div>
  );
}
