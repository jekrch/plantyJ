import { useEffect, type RefObject } from "react";

/**
 * Locks body scroll and prevents overscroll/bounce on iOS while the
 * referenced container is mounted.
 */
export function useBodyScrollLock(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    const preventScroll = (e: TouchEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target)) return;

      // Allow scrolling inside scrollable regions (e.g. info drawer)
      const scrollable = (target as Element).closest?.(".info-modal-scroll");
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return;

      e.preventDefault();
    };
    document.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = prevTouch;
      document.removeEventListener("touchmove", preventScroll);
    };
  }, [containerRef]);
}