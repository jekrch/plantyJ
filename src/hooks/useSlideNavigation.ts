import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Plant } from "../types";

export interface SlideNavigationState {
    slideTrackRef: React.RefObject<HTMLDivElement | null>;
    slideActive: boolean;
    slideAnimating: boolean;
    swipeOffset: number;
    swipeOffsetRef: React.MutableRefObject<number>;
    commitLockRef: React.MutableRefObject<boolean>;

    applySlideOffset: (offset: number, animate?: boolean) => void;
    commitSlide: (direction: "prev" | "next") => void;
    snapBack: () => void;
    resolveSlide: (gestureStartTime: number) => void;
    setSlideActive: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages the three-slot slide carousel: swipe offset tracking, animated
 * commit/snap-back, and DOM resets on navigation.
 */
export function useSlideNavigation(
    panels: Plant[],
    currentIndex: number,
    onNavigate: (index: number) => void
): SlideNavigationState {
    const slideTrackRef = useRef<HTMLDivElement>(null);
    const swipeOffsetRef = useRef(0);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [slideAnimating, setSlideAnimating] = useState(false);
    const [slideActive, setSlideActive] = useState(false);
    const commitLockRef = useRef(false);

    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < panels.length - 1;

    const applySlideOffset = useCallback((offset: number, animate = false) => {
        swipeOffsetRef.current = offset;
        const track = slideTrackRef.current;
        if (track) {
            track.style.transition = animate
                ? "transform 0.28s cubic-bezier(0.2, 0, 0, 1)"
                : "none";
            track.style.transform = `translateX(${offset}px)`;
        }
        setSwipeOffset(offset);
    }, []);

    const snapBack = useCallback(() => {
        setSlideAnimating(true);
        applySlideOffset(0, true);

        const track = slideTrackRef.current;
        let done = false;
        const onEnd = () => {
            if (done) return;
            done = true;
            track?.removeEventListener("transitionend", onEnd);
            setSlideAnimating(false);
            setSlideActive(false);
        };
        if (track) {
            track.addEventListener("transitionend", onEnd, { once: true });
            setTimeout(onEnd, 350);
        }
    }, [applySlideOffset]);

    const readyRef = useRef(true);

    const commitSlide = useCallback(
        (direction: "prev" | "next") => {
            if (commitLockRef.current || !readyRef.current) return;
            commitLockRef.current = true;
            readyRef.current = false;

            const vw = window.innerWidth;
            const targetOffset = direction === "prev" ? vw : -vw;
            setSlideActive(true);
            setSlideAnimating(true);

            requestAnimationFrame(() => {
                applySlideOffset(targetOffset, true);

                const track = slideTrackRef.current;
                let cleaned = false;

                const cleanup = () => {
                    if (cleaned) return;
                    cleaned = true;
                    track?.removeEventListener("transitionend", onTransitionEnd);

                    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
                    if (newIndex < 0 || newIndex >= panels.length) {
                        commitLockRef.current = false;
                        return;
                    }

                    const newPlant = panels[newIndex];
                    const preload = new Image();
                    preload.src = `${import.meta.env.BASE_URL}${newPlant.image}`;

                    const doNavigate = () => onNavigate(newIndex);

                    // Add a timeout so a stalled decode can't block navigation forever
                    const timeout = setTimeout(doNavigate, 300);
                    preload
                        .decode()
                        .then(() => { clearTimeout(timeout); doNavigate(); })
                        .catch(() => { clearTimeout(timeout); doNavigate(); });
                };

                const onTransitionEnd = () => cleanup();
                if (track) {
                    track.addEventListener("transitionend", onTransitionEnd, { once: true });
                    setTimeout(cleanup, 400);
                }
            });
        },
        [applySlideOffset, currentIndex, panels, onNavigate]
    );

    const resolveSlide = useCallback(
        (gestureStartTime: number) => {
            const offset = swipeOffsetRef.current;
            const dt = Date.now() - gestureStartTime;
            const velocity = Math.abs(offset) / Math.max(dt, 1);

            const threshold = window.innerWidth * 0.25;
            const velocityThreshold = 0.4;

            if (offset > 0 && hasPrev && (offset > threshold || velocity > velocityThreshold)) {
                commitSlide("prev");
            } else if (offset < 0 && hasNext && (Math.abs(offset) > threshold || velocity > velocityThreshold)) {
                commitSlide("next");
            } else {
                snapBack();
            }
        },
        [hasPrev, hasNext, commitSlide, snapBack]
    );

    // DOM resets on navigation (pre-paint)

    useLayoutEffect(() => {
        const track = slideTrackRef.current;
        if (track) {
            track.style.transition = "none";
            track.offsetHeight;
            track.style.transform = "translateX(0px)";
        }
        swipeOffsetRef.current = 0;
        commitLockRef.current = false;
    }, [currentIndex]);

    // React state cleanup — runs after paint
    useEffect(() => {
        setSwipeOffset(0);
        setSlideAnimating(false);
        setSlideActive(false);
        // Allow next commit only after React has painted the new panel
        readyRef.current = true;
    }, [currentIndex]);

    return {
        slideTrackRef,
        slideActive,
        slideAnimating,
        swipeOffset,
        swipeOffsetRef,
        commitLockRef,
        applySlideOffset,
        commitSlide,
        snapBack,
        resolveSlide,
        setSlideActive,
    };
}