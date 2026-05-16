import { LoaderCircle } from "lucide-react";

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

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-ink-muted text-sm">
        No organisms yet. Send a photo to the Telegram bot to get started.
      </p>
    </div>
  );
}