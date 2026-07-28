import { EVENTS, Joyride, STATUS, type EventData, type Options, type Step } from "react-joyride";

/**
 * The Joyride mount, kept in its own module so `react-joyride` and its
 * floating-ui/deep-equal dependency tree load only when a tour actually runs.
 * GardenTour owns all the logic — when to run, which steps, what to record —
 * and stays in the main bundle because it has to listen for tour requests from
 * the account menu on every page.
 */

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

interface Props {
  steps: Step[];
  run: boolean;
  /** Called once the tour stops. `finished` is false when it was skipped. */
  onDone: (finished: boolean) => void;
}

export default function TourRunner({ steps, run, onDone }: Props) {
  const handleEvent = (data: EventData) => {
    const done =
      data.type === EVENTS.TOUR_END ||
      data.status === STATUS.FINISHED ||
      data.status === STATUS.SKIPPED;
    if (done) onDone(data.status === STATUS.FINISHED);
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      onEvent={handleEvent}
      continuous
      options={{ ...TOUR_OPTIONS, showProgress: steps.length > 1 }}
      locale={LOCALE}
      styles={TOUR_STYLES}
    />
  );
}
