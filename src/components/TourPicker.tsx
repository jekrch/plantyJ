import { useCallback, useEffect, useRef } from "react";
import { Compass, X } from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { availableTours, type TourId } from "../data/tours";

/**
 * Menu of guided tours. Shown when a user picks "Take the tour" rather than
 * being dropped straight into one, since which tour is useful depends entirely
 * on what they're trying to learn. Finishing a tour reopens this so they can
 * pick another.
 *
 * Sits above the relationship studio's z-80 portal: the food web tour leaves
 * the studio open when it ends, and this has to come back on top of it.
 */

interface Props {
  organismCount: number;
  onPick: (id: TourId) => void;
  onClose: () => void;
}

export default function TourPicker({ organismCount, onPick, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(containerRef);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const tours = availableTours(organismCount);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-95 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a tour"
    >
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md rounded-lg border border-ink-faint/25 bg-surface-raised shadow-2xl shadow-black/50 overflow-hidden">
        <div className="relative flex items-center justify-center px-5 pt-4 pb-3 border-b border-ink-faint/20">
          <div className="flex items-center gap-2">
            <Compass size={16} strokeWidth={1.5} className="stroke-accent" />
            <h2 className="font-display text-sm tracking-tight text-ink">Take a tour</h2>
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

        <div className="px-5 py-4 space-y-2">
          {tours.map((tour) => (
            <button
              key={tour.id}
              onClick={() => onPick(tour.id)}
              className="w-full text-left rounded-md border border-ink-faint/20 px-4 py-3 hover:border-accent/40 hover:bg-white/5 transition-colors cursor-pointer"
            >
              <span className="block font-display text-sm text-ink">{tour.title}</span>
              <span className="block mt-1 text-xs text-ink-muted leading-relaxed">
                {tour.blurb}
              </span>
            </button>
          ))}

          {/* Every tour but "adding" needs something in the garden to point at. */}
          {organismCount === 0 && (
            <p className="pt-1 text-xs text-ink-faint leading-relaxed">
              More tours unlock once your garden has a plant or two in it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
