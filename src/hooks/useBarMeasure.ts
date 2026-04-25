import { useEffect, useState, type RefObject } from "react";

/**
 * Measures the height of the top and bottom bars so the image area
 * can be constrained to fit between them.
 */
export function useBarMeasure(
  topBarRef: RefObject<HTMLDivElement | null>,
  bottomBarRef: RefObject<HTMLDivElement | null>,
  /** Re-measure whenever this key changes (e.g. currentIndex) */
  measureKey: unknown
) {
  const [topBarH, setTopBarH] = useState(0);
  const [bottomBarH, setBottomBarH] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (topBarRef.current) setTopBarH(topBarRef.current.offsetHeight);
      if (bottomBarRef.current) setBottomBarH(bottomBarRef.current.offsetHeight);
    };
    measure();

    const ro = new ResizeObserver(measure);
    if (topBarRef.current) ro.observe(topBarRef.current);
    if (bottomBarRef.current) ro.observe(bottomBarRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey]);

  return { topBarH, bottomBarH };
}