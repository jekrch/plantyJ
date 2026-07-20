import { X } from "lucide-react";

/** Shared modal shell for the composer and edge editor. */
export default function Modal({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-black/70"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm uppercase tracking-widest text-ink">{title}</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
