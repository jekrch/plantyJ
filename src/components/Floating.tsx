import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

// Above the lightbox (--rvl-z: 50) so popups work inside the info drawer.
const Z_INDEX = 80;
const GAP = 8;
const MARGIN = 8;
const EXIT_MS = 120;

type Side = "top" | "bottom";
type Phase = "closed" | "open" | "closing";

interface Position {
  top: number;
  left: number;
  side: Side;
  arrowX: number;
}

function place(anchor: DOMRect, width: number, height: number, prefer: Side): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsBelow = anchor.bottom + GAP + height <= vh - MARGIN;
  const fitsAbove = anchor.top - GAP - height >= MARGIN;
  const side: Side =
    prefer === "bottom" ? (fitsBelow || !fitsAbove ? "bottom" : "top") : fitsAbove || !fitsBelow ? "top" : "bottom";
  const cx = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(cx - width / 2, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
  return {
    top: side === "bottom" ? anchor.bottom + GAP : anchor.top - GAP - height,
    left,
    side,
    arrowX: Math.min(Math.max(cx - left, 12), width - 12),
  };
}

/** Open/close state that keeps the panel mounted while its exit animation plays. */
export function useFloatingPhase() {
  const [phase, setPhase] = useState<Phase>("closed");
  const timer = useRef<number | undefined>(undefined);

  const open = useCallback(() => {
    window.clearTimeout(timer.current);
    setPhase("open");
  }, []);
  const close = useCallback((animated = true) => {
    window.clearTimeout(timer.current);
    if (!animated) {
      setPhase("closed");
      return;
    }
    setPhase((p) => (p === "closed" ? p : "closing"));
    timer.current = window.setTimeout(() => setPhase("closed"), EXIT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { phase, isOpen: phase === "open", open, close };
}

interface PanelProps {
  anchorRef: RefObject<HTMLElement | null>;
  phase: Phase;
  placement?: Side;
  id?: string;
  role?: string;
  title?: ReactNode;
  className?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/**
 * A themed panel portaled to <body> and pinned next to its anchor, so a
 * scrolling or overflow-hidden parent can't clip it. Flips above/below to stay
 * on screen and follows the anchor on scroll and resize.
 */
export function FloatingPanel({
  anchorRef,
  phase,
  placement = "bottom",
  id,
  role = "tooltip",
  title,
  className = "w-60",
  panelRef,
  children,
}: PanelProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = panelRef ?? ownRef;
  const [pos, setPos] = useState<Position | null>(null);
  const mounted = phase !== "closed";

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = ref.current;
    if (!anchor || !panel) return;
    setPos(place(anchor.getBoundingClientRect(), panel.offsetWidth, panel.offsetHeight, placement));
  }, [anchorRef, ref, placement]);

  useLayoutEffect(() => {
    if (!mounted) {
      setPos(null);
      return;
    }
    update();
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [mounted, update]);

  if (!mounted) return null;

  const side = pos?.side ?? placement;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      data-side={side}
      // Keep clicks from reaching the lightbox's gesture/backdrop handlers,
      // which see portal events through the React tree.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`float-panel ${phase === "closing" ? "float-out" : "float-in"} fixed rounded-lg border border-accent/20 bg-surface-raised px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted font-sans normal-case tracking-normal shadow-[0_14px_36px_-10px_rgba(0,0,0,0.75)] ${className}`}
      style={{
        zIndex: Z_INDEX,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
        transformOrigin: pos ? `${pos.arrowX}px ${side === "bottom" ? "0" : "100%"}` : undefined,
      }}
    >
      {pos && (
        <span
          aria-hidden
          className={`absolute h-2 w-2 rotate-45 bg-surface-raised border-accent/20 ${
            side === "bottom" ? "-top-[5px] border-t border-l" : "-bottom-[5px] border-b border-r"
          }`}
          style={{ left: pos.arrowX - 4 }}
        />
      )}
      {title && (
        <p className="font-display text-[9px] tracking-widest uppercase text-accent mb-1.5">
          {title}
        </p>
      )}
      {children}
    </div>,
    document.body,
  );
}

/** Close on Escape or a pointer press outside the given elements. */
export function useDismiss(
  active: boolean,
  close: () => void,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef?.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, close, anchorRef, panelRef]);
}

// One hover tooltip at a time. Moving straight from one trigger to another
// ("warm") swaps instantly instead of waiting out the hover delay again.
const HOVER_DELAY_MS = 220;
const WARM_MS = 300;
let activeTooltipClose: (() => void) | null = null;
let warmUntil = 0;

interface TooltipProps {
  content: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  placement?: Side;
  /** Tap opens/closes the tooltip on touch screens. Off for triggers that act on tap. */
  tapToggle?: boolean;
  panelClassName?: string;
}

export function Tooltip({
  content,
  title,
  children,
  className = "",
  placement = "top",
  tapToggle = true,
  panelClassName = "w-56",
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const { phase, isOpen, open, close } = useFloatingPhase();
  const delay = useRef<number | undefined>(undefined);
  const pointerType = useRef<string>("mouse");
  const id = useId();
  // Stable identity for the "one tooltip at a time" registry.
  const instantClose = useRef<() => void>(() => {});

  const hide = useCallback(
    (animated = true) => {
      window.clearTimeout(delay.current);
      close(animated);
      if (activeTooltipClose === instantClose.current) {
        activeTooltipClose = null;
        warmUntil = Date.now() + WARM_MS;
      }
    },
    [close],
  );
  instantClose.current = () => hide(false);

  const show = useCallback(() => {
    window.clearTimeout(delay.current);
    const reveal = () => {
      if (activeTooltipClose && activeTooltipClose !== instantClose.current) activeTooltipClose();
      activeTooltipClose = instantClose.current;
      open();
    };
    if (Date.now() < warmUntil || activeTooltipClose) reveal();
    else delay.current = window.setTimeout(reveal, HOVER_DELAY_MS);
  }, [open]);

  useEffect(() => () => window.clearTimeout(delay.current), []);
  useDismiss(isOpen && tapToggle, hide, anchorRef);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        aria-describedby={isOpen ? id : undefined}
        tabIndex={tapToggle ? 0 : undefined}
        role={tapToggle ? "button" : undefined}
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={() => pointerType.current === "mouse" && show()}
        onBlur={() => hide()}
        onClick={() => {
          if (!tapToggle || pointerType.current === "mouse") return;
          if (isOpen) hide();
          else {
            activeTooltipClose?.();
            activeTooltipClose = instantClose.current;
            open();
          }
        }}
        onKeyDown={(e) => {
          if (tapToggle && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            if (isOpen) hide();
            else show();
          }
        }}
      >
        {children}
      </span>
      <FloatingPanel
        anchorRef={anchorRef}
        phase={phase}
        placement={placement}
        id={id}
        title={title}
        className={`${panelClassName} pointer-events-none`}
      >
        {content}
      </FloatingPanel>
    </>
  );
}
