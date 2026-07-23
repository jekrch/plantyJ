import { useCallback, useEffect, useRef, useState } from "react";
import { Cloud, Sprout, X } from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { setSourceMode } from "../data/source";

const SEEN_KEY = "plantyj:welcomed";

/**
 * Whether this browser has already been shown the welcome. Storage failures
 * (private mode, blocked cookies) count as "seen" so a browser that can't
 * remember the dismissal doesn't greet the visitor on every page load.
 */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markWelcomeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do — the visitor just sees the welcome again next time.
  }
}

// Matches InfoModal's entrance/exit feel.
const ENTER_MS = 320;
const EXIT_MS = 200;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * First-visit greeting: explains that the site is a personal plant journal and
 * that visitors can start their own, Drive-backed one from the cloud menu.
 */
export default function WelcomeModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two rAFs so the entrance transition has a "from" frame to animate from.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  if (!mounted) return null;
  return <WelcomeModalContent onClose={onClose} visible={visible} />;
}

function WelcomeModalContent({ onClose, visible }: Omit<Props, "open"> & { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(containerRef);

  const handleClose = useCallback(() => {
    markWelcomeSeen();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  // Switching source reloads the app, so the flag has to be written first or
  // the welcome would reappear in the fresh session.
  const handleStart = () => {
    markWelcomeSeen();
    setSourceMode("drive");
  };

  const transition = [
    `opacity ${visible ? ENTER_MS : EXIT_MS}ms ${visible ? EASE_OUT : EASE_IN}`,
    `transform ${visible ? ENTER_MS : EXIT_MS}ms ${visible ? EASE_OUT : EASE_IN}`,
  ].join(", ");

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to PlantyJ"
    >
      <div
        className="absolute inset-0 bg-black/70"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity ${visible ? ENTER_MS : EXIT_MS}ms ${visible ? EASE_OUT : EASE_IN}`,
        }}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-md rounded-lg border border-ink-faint/25 bg-surface-raised shadow-2xl shadow-black/50 overflow-hidden origin-center"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1) translateY(0)" : "scale(0.94) translateY(12px)",
          transition,
          willChange: "opacity, transform",
        }}
      >
        <div className="relative flex items-center justify-center px-5 pt-4 pb-3 border-b border-ink-faint/20">
          <div className="flex items-center gap-2">
            <Sprout size={16} strokeWidth={1.5} className="stroke-accent" />
            <h2 className="font-display text-sm tracking-tight text-ink">Welcome to PlantyJ</h2>
          </div>
          <button
            onClick={handleClose}
            className="absolute right-4 flex items-center justify-center h-7 w-7 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-ink leading-relaxed">
            This is our personal plant journal, with the pictures, identifications, and zones of
            everything growing around our house.
          </p>
          <p className="text-sm text-ink leading-relaxed">
            If you like it, you can now start a journal of your own. Sign in with a Google account
            and your plants, photos, and notes are saved to a{" "}
            <span className="text-ink">PlantyJ</span> folder in your own Google Drive. We keep no
            copy of your garden, and no one else can see it unless you choose to share.
          </p>
          <p className="flex items-start gap-2 text-xs text-ink-muted leading-relaxed">
            <Cloud size={15} strokeWidth={1.5} className="mt-px shrink-0 text-accent" />
            <span>
              You can switch between our garden and yours any time from the cloud icon in the
              header.
            </span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 pb-5">
          <a
            href="/privacy.html"
            className="px-1 text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Privacy
          </a>
          <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="rounded-md px-3 py-1.5 text-xs text-ink-muted hover:bg-white/5 hover:text-ink transition-colors cursor-pointer"
          >
            See the journal
          </button>
          <button
            onClick={handleStart}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-display tracking-wide text-surface hover:opacity-90 transition-opacity cursor-pointer"
          >
            {/* Must be `stroke-*`, not `text-*`: the global `*` rule in index.css
                sets color on the svg's paths too, and they resolve lucide's
                inherited `stroke: currentColor` against that instead of the svg's. */}
            <Cloud size={14} strokeWidth={2} className="stroke-surface" />
            Start my own
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
