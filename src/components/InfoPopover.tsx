import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { FloatingPanel, useDismiss, useFloatingPhase } from "./Floating";

interface Props {
  label: string;
  children: ReactNode;
  /** Small uppercase heading inside the panel. */
  title?: ReactNode;
  className?: string;
  iconSize?: number;
  panelClassName?: string;
}

// Click-to-open rather than hover so it works on touch screens too.
export function InfoPopover({
  label,
  children,
  title,
  className = "",
  iconSize = 11,
  panelClassName = "w-60",
}: Props) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { phase, isOpen, open, close } = useFloatingPhase();
  const dismiss = useCallback(() => close(), [close]);
  useDismiss(isOpen, dismiss, anchorRef, panelRef);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) close();
          else open();
        }}
        aria-label={label}
        aria-expanded={isOpen}
        className={`inline-flex items-center justify-center rounded-full transition-colors cursor-pointer ${
          isOpen ? "text-accent" : "text-ink-faint hover:text-ink-muted"
        }`}
      >
        <Info size={iconSize} strokeWidth={1.75} />
      </button>
      <FloatingPanel
        anchorRef={anchorRef}
        panelRef={panelRef}
        phase={phase}
        role="dialog"
        title={title}
        className={panelClassName}
      >
        {children}
      </FloatingPanel>
    </span>
  );
}
