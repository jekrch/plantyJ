import { describe, it, expect } from "bun:test";
import { pickTourStage, type TourConditions } from "../components/GardenTour";
import { TOUR_DONE, TOUR_NONE, TOUR_STARTED } from "../data/profile";
import { availableTours, tourSteps, TOURS, type TourControls } from "../data/tours";

const base: TourConditions = {
  stage: TOUR_NONE,
  organismCount: 0,
  ready: true,
  driveMode: true,
  signedIn: true,
};

const at = (over: Partial<TourConditions>) => pickTourStage({ ...base, ...over });

describe("pickTourStage", () => {
  it("runs stage 1 for a new cloud user with an empty garden", () => {
    expect(at({})).toBe(TOUR_STARTED);
  });

  it("runs stage 2 once a stage-1 user has plants", () => {
    expect(at({ stage: TOUR_STARTED, organismCount: 3 })).toBe(TOUR_DONE);
  });

  it("does not re-run stage 1 while the garden is still empty", () => {
    expect(at({ stage: TOUR_STARTED, organismCount: 0 })).toBeNull();
  });

  it("never runs again once the tour is done", () => {
    expect(at({ stage: TOUR_DONE, organismCount: 0 })).toBeNull();
    expect(at({ stage: TOUR_DONE, organismCount: 9 })).toBeNull();
  });

  it("leaves pre-tour accounts alone — no stage recorded but plants already there", () => {
    expect(at({ stage: TOUR_NONE, organismCount: 40 })).toBeNull();
  });

  it("stays out of the founder's static garden", () => {
    expect(at({ driveMode: false })).toBeNull();
  });

  it("waits for a signed-in session", () => {
    expect(at({ signedIn: false })).toBeNull();
  });

  it("waits for the data load to settle before measuring anything", () => {
    expect(at({ ready: false })).toBeNull();
    expect(at({ ready: false, stage: TOUR_STARTED, organismCount: 3 })).toBeNull();
  });
});

describe("availableTours", () => {
  it("offers only the add-specimen tour on an empty garden", () => {
    // Everything else points at organisms, view modes, or the food web, none
    // of which are mounted with nothing in the garden.
    expect(availableTours(0).map((t) => t.id)).toEqual(["adding"]);
  });

  it("offers every tour once there are plants", () => {
    expect(availableTours(5).map((t) => t.id)).toEqual(TOURS.map((t) => t.id));
  });
});

describe("tourSteps", () => {
  const controls: TourControls = {
    openAddSheet: () => {},
    closeAddSheet: () => {},
    showWebView: () => {},
  };

  it("gives every tour a first step that needs no beacon", () => {
    for (const { id } of TOURS) {
      const steps = tourSteps(id, controls, true);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0].skipBeacon).toBe(true);
    }
  });

  it("drops the model steps for a user who opted out of AI features", () => {
    const withAI = tourSteps("relationships", controls, true);
    const without = tourSteps("relationships", controls, false);
    expect(withAI.length).toBe(without.length + 1);
    expect(without.some((s) => s.target === '[data-tour="rel-ai"]')).toBe(false);
    expect(tourSteps("basics", controls, false).some((s) => s.title === "Model-assisted extras")).toBe(
      false,
    );
  });

  it("starts the adding tour on the header button, with the sheet shut", async () => {
    let closed = false;
    const steps = tourSteps("adding", { ...controls, closeAddSheet: () => (closed = true) }, true);
    expect(steps[0].target).toBe('[data-tour="add"]');
    await steps[0].before?.({} as never);
    expect(closed).toBe(true);
  });

  it("opens the sheet only once the tour steps into it", async () => {
    let opened = false;
    const steps = tourSteps("adding", { ...controls, openAddSheet: () => (opened = true) }, true);
    await steps[0].before?.({} as never);
    expect(opened).toBe(false);
    await steps[1].before?.({} as never);
    expect(opened).toBe(true);
  });

  it("switches to the web view before touring the relationship studio", async () => {
    let shown = false;
    const steps = tourSteps(
      "relationships",
      { ...controls, showWebView: () => (shown = true) },
      true,
    );
    await steps[0].before?.({} as never);
    expect(shown).toBe(true);
  });
});
