import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENTS, Joyride, STATUS, type EventData, type Options } from "react-joyride";
import {
  advanceTourStage,
  getTourStage,
  PROFILE_CHANGED_EVENT,
  TOUR_DONE,
  TOUR_NONE,
  TOUR_STARTED,
} from "../data/profile";
import { isDriveMode } from "../data/source";
import { getSessionUser } from "../data/googleAuth";
import { useAIFeaturesVisible } from "../hooks/useAIFeatures";
import { tourSteps, type TourControls, type TourId } from "../data/tours";
import TourPicker from "./TourPicker";

/**
 * Guided tours for cloud users.
 *
 * Auto-runs once for a new account: a getting-started prompt against the empty
 * garden, then the basics tour on the first visit that has plants in it (every
 * anchor the basics tour points at is gated behind having data, so it can't run
 * any earlier). Progress lives in the Drive profile, so touring on a laptop
 * doesn't re-tour the phone.
 *
 * Beyond that it's on demand — `requestTour()` from the account menu opens a
 * picker, and the chosen tour runs regardless of what's been seen before.
 *
 * Targets are `data-tour` attributes rather than refs: the anchors are spread
 * across the header, the add sheet, the web view, and the relationship studio,
 * and threading refs through all of that would be far more invasive than a
 * selector.
 */

interface Props {
  /** Number of organisms currently in the garden — gates which tours can run. */
  organismCount: number;
  /** True once the data load has settled; steps can't measure before that. */
  ready: boolean;
  /** Lets a tour open the UI its steps point at. */
  controls: TourControls;
}

/** Fired to open the tour picker. */
export const TOUR_REQUESTED_EVENT = "plantyj:tour-requested";

export function requestTour(): void {
  window.dispatchEvent(new Event(TOUR_REQUESTED_EVENT));
}

export interface TourConditions {
  /** Stage already recorded in the profile. */
  stage: number;
  organismCount: number;
  ready: boolean;
  driveMode: boolean;
  signedIn: boolean;
}

/**
 * Which stage the *automatic* tour should run, or null for none.
 *
 * Note the deliberate gap: a user at TOUR_NONE who already has plants gets
 * nothing. That's an account created before the tour existed — touring an
 * established garden unprompted is an interruption, not an introduction. They
 * can still reach every tour from the account menu.
 */
export function pickTourStage({
  stage,
  organismCount,
  ready,
  driveMode,
  signedIn,
}: TourConditions): number | null {
  if (!ready || !driveMode || !signedIn) return null;
  if (stage === TOUR_NONE && organismCount === 0) return TOUR_STARTED;
  if (stage === TOUR_STARTED && organismCount > 0) return TOUR_DONE;
  return null;
}

// Mirrors the palette in index.css — joyride styles inline, so it can't read
// the Tailwind custom properties.
const TOUR_OPTIONS: Partial<Options> = {
  arrowColor: "#112014",
  backgroundColor: "#112014",
  overlayColor: "rgba(0, 0, 0, 0.72)",
  primaryColor: "#7fb069",
  textColor: "#d8e6d2",
  // Above the sticky header (z-40), the modals (z-50), and the relationship
  // studio, which portals itself to z-80.
  zIndex: 90,
  spotlightRadius: 8,
  scrollOffset: 100, // clears the sticky header when scrolling a step into view
  overlayClickAction: false,
  buttons: ["back", "skip", "primary"],
  // The add sheet and the studio mount as the tour walks into them; give the
  // anchors longer than the 1s default to appear.
  targetWaitTimeout: 4000,
};

const TOUR_STYLES = {
  tooltip: {
    borderRadius: 8,
    border: "1px solid rgba(86, 104, 90, 0.25)",
    fontSize: 13,
    padding: 16,
  },
  tooltipTitle: {
    fontSize: 13,
    letterSpacing: "-0.01em",
    margin: 0,
    marginBottom: 6,
  },
  tooltipContent: {
    lineHeight: 1.6,
    padding: 0,
    textAlign: "left" as const,
  },
  buttonPrimary: {
    borderRadius: 6,
    color: "#0b140d",
    fontSize: 12,
    letterSpacing: "0.02em",
    padding: "6px 12px",
  },
  buttonBack: {
    color: "#8aa085",
    fontSize: 12,
    marginRight: 8,
  },
  buttonSkip: {
    color: "#8aa085",
    fontSize: 12,
  },
};

const LOCALE = {
  back: "Back",
  close: "Close",
  last: "Done",
  next: "Next",
  skip: "Skip",
};

/** The one-step nudge a brand-new, empty garden gets automatically. */
const GETTING_STARTED_STEPS = [
  {
    target: '[data-tour="add"]',
    title: "Add your first plant",
    content:
      "Snap or upload a photo and it goes straight into your own Google Drive. You look the species up by name — search covers a curated dataset plus iNaturalist — then set its zone and any notes. That's the whole flow.",
    skipBeacon: true,
    placement: "bottom" as const,
  },
  {
    target: '[data-tour="source"]',
    title: "Switch gardens any time",
    content:
      "This is where you move between our garden and yours, where your account settings live, and where you can take these tours again later.",
    placement: "bottom" as const,
  },
];

export default function GardenTour({ organismCount, ready, controls }: Props) {
  const aiVisible = useAIFeaturesVisible();
  const [stage, setStage] = useState(getTourStage);
  const [run, setRun] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** A tour the user explicitly chose; overrides the automatic stage. */
  const [chosen, setChosen] = useState<TourId | null>(null);

  // The stage is mirrored to localStorage but Drive is authoritative, so pick
  // up the real value once the profile lands.
  useEffect(() => {
    const sync = () => setStage(getTourStage());
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    const onRequest = () => setPickerOpen(true);
    window.addEventListener(TOUR_REQUESTED_EVENT, onRequest);
    return () => window.removeEventListener(TOUR_REQUESTED_EVENT, onRequest);
  }, []);

  const autoStage = useMemo(
    () =>
      pickTourStage({
        stage,
        organismCount,
        ready,
        driveMode: isDriveMode(),
        signedIn: Boolean(getSessionUser()),
      }),
    [ready, stage, organismCount],
  );

  const steps = useMemo(() => {
    if (chosen) return tourSteps(chosen, controls, aiVisible);
    if (autoStage === TOUR_STARTED) return GETTING_STARTED_STEPS;
    if (autoStage === TOUR_DONE) return tourSteps("basics", controls, aiVisible);
    return [];
  }, [chosen, autoStage, controls, aiVisible]);

  const active = Boolean(chosen) || autoStage !== null;

  // Joyride measures targets on mount, so give the layout a frame to settle
  // before starting — otherwise the first spotlight lands on a stale rect.
  useEffect(() => {
    if (!active || steps.length === 0 || pickerOpen) {
      setRun(false);
      return;
    }
    const t = setTimeout(() => setRun(true), 400);
    return () => clearTimeout(t);
  }, [active, steps.length, pickerOpen]);

  const handlePick = useCallback((id: TourId) => {
    setPickerOpen(false);
    setChosen(id);
  }, []);

  // Skipping counts as completing: the user has been offered this and declined
  // it, so re-offering on the next visit would be nagging.
  const handleEvent = (data: EventData) => {
    const done =
      data.type === EVENTS.TOUR_END ||
      data.status === STATUS.FINISHED ||
      data.status === STATUS.SKIPPED;
    if (!done) return;

    setRun(false);

    if (chosen) {
      // The add sheet is the tour's doing, so the tour puts it away. The
      // relationship studio is left open on purpose — someone who just toured
      // it is there to use it, and closing it would undo the trip.
      if (chosen === "adding") controls.closeAddSheet();
      // Clearing this is what lets the same tour be picked again: the start
      // effect keys off the steps, so the selection has to actually change.
      setChosen(null);
      // Reaching the end drops you back at the menu to pick another. Skipping
      // does not: that's a request to be left alone, and reopening the thing
      // they just dismissed would trap them in it.
      if (data.status === STATUS.FINISHED) setPickerOpen(true);
      return;
    }

    if (autoStage) {
      setStage(autoStage); // stops this stage re-arming before Drive answers
      advanceTourStage(autoStage).catch(() => {
        // A failed write just means they may see it once more; not worth
        // interrupting them over.
      });
    }
  };

  return (
    <>
      {pickerOpen && (
        <TourPicker
          organismCount={organismCount}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {active && steps.length > 0 && (
        <Joyride
          steps={steps}
          run={run}
          onEvent={handleEvent}
          continuous
          options={{ ...TOUR_OPTIONS, showProgress: steps.length > 1 }}
          locale={LOCALE}
          styles={TOUR_STYLES}
        />
      )}
    </>
  );
}
