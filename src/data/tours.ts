import type { Step } from "react-joyride";

/**
 * The guided tours a cloud user can pick from, and the steps each one walks.
 *
 * Two of these tour UI that isn't on screen when the tour starts — the add
 * sheet, the relationship studio. Joyride's `before` hook is async and the
 * tour waits on it, so each such step opens what it needs and waits for the
 * anchor to mount before the spotlight is measured.
 *
 * Living in `data/` rather than beside the component so the step copy and the
 * gating rules can be unit-tested without pulling React in.
 */

export type TourId = "basics" | "adding" | "relationships";

export interface TourDefinition {
  id: TourId;
  title: string;
  blurb: string;
  /** Needs at least one organism in the garden for its anchors to exist. */
  needsOrganisms: boolean;
}

export const TOURS: TourDefinition[] = [
  {
    id: "basics",
    title: "The basics",
    blurb: "Views, opening a plant, and where the model-assisted extras live.",
    needsOrganisms: true,
  },
  {
    id: "adding",
    title: "Adding a specimen",
    blurb: "Photos, finding the species, zones, and tags — the whole entry flow.",
    needsOrganisms: false,
  },
  {
    id: "relationships",
    title: "Building the food web",
    blurb: "Connect organisms by dragging, in bulk, or with a model's help.",
    needsOrganisms: true,
  },
];

/** Tours offerable right now. Ones whose anchors can't exist are hidden. */
export function availableTours(organismCount: number): TourDefinition[] {
  return TOURS.filter((t) => !t.needsOrganisms || organismCount > 0);
}

/**
 * Poll for an element that a `before` hook has just caused to render. Resolves
 * null on timeout rather than throwing — joyride reports a missing target on
 * its own, and a tour that half-works beats one that dies mid-step.
 */
export function waitForElement(selector: string, timeoutMs = 3000): Promise<HTMLElement | null> {
  // No DOM under prerender or in tests; there is nothing to wait for.
  if (typeof document === "undefined") return Promise.resolve(null);

  const existing = document.querySelector<HTMLElement>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) return resolve(el);
      if (Date.now() - started > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * Click an element the tour needs opened, once it exists.
 *
 * Synthetic clicks rather than lifted state: the relationship studio and its
 * sub-sheets are local to their own components, and threading open/close props
 * up through WebView into App purely so a tour could drive them would be a far
 * larger change than the tour is worth. The anchors are already there for the
 * spotlight, so the tour reuses them.
 */
export async function clickToOpen(selector: string): Promise<void> {
  const el = await waitForElement(selector);
  el?.click();
}

/** Steps for a tour. `controls` lets a step open UI it needs before measuring. */
export interface TourControls {
  openAddSheet: () => void;
  closeAddSheet: () => void;
  showWebView: () => void;
}

export function tourSteps(id: TourId, controls: TourControls, aiVisible: boolean): Step[] {
  if (id === "basics") return basicsSteps(aiVisible);
  if (id === "adding") return addingSteps(controls);
  return relationshipSteps(controls, aiVisible);
}

function basicsSteps(aiVisible: boolean): Step[] {
  const steps: Step[] = [
    {
      target: '[data-tour="views"]',
      title: "Five ways to look at it",
      content:
        "The gallery is just the start. Group by plant or by zone, climb the taxonomy in tree view, or see what feeds what in the food web.",
      skipBeacon: true,
      placement: "bottom",
    },
    {
      target: '[data-tour="card"]',
      title: "Open a plant",
      content:
        "Tap any photo for the full record — every picture of that plant, where it's growing, and what's been noted about it over time.",
      placement: "bottom",
    },
  ];

  if (aiVisible) {
    steps.push({
      target: '[data-tour="source"]',
      title: "Model-assisted extras",
      content:
        "Two features here can hand you a ready-made prompt to paste into any chat model, then apply its reply back to your garden: mapping relationships between your plants, and drafting eco-fit analyses for each zone. You can turn both off in your account settings.",
      placement: "bottom",
    });
  }

  return steps;
}

function addingSteps(controls: TourControls): Step[] {
  return [
    {
      target: '[data-tour="add"]',
      title: "Start here",
      content:
        "This button in the header opens the entry sheet. It's the way everything gets into your garden.",
      skipBeacon: true,
      placement: "bottom",
      // The sheet covers the header, so it has to be shut for this step —
      // matters when the user steps back to it from the sheet steps below.
      before: async () => {
        controls.closeAddSheet();
        await waitForElement('[data-tour="add"]');
      },
    },
    {
      target: '[data-tour="entry-photos"]',
      title: "Start with photos",
      content:
        "Choose files, drop them in, or use your camera on a phone. Everything uploads straight to your own Google Drive — you can add several shots of the same plant at once.",
      placement: "bottom",
      before: async () => {
        controls.openAddSheet();
        await waitForElement('[data-tour="entry-photos"]');
      },
    },
    {
      target: '[data-tour="entry-plant"]',
      title: "Which plant is it?",
      content:
        "Pick one you've already recorded, or choose “New plant” and search by common or scientific name — the lookup covers a curated dataset plus iNaturalist, and fills in the short code and names for you.",
      placement: "top",
    },
    {
      target: '[data-tour="entry-zone"]',
      title: "Where is it growing?",
      content:
        "Zones are your own areas — a bed, a corner, a pot. The same plant in two zones stays two separate entries, which is what makes the zone views and eco-fit analyses useful later.",
      placement: "top",
    },
    {
      target: '[data-tour="entry-tags"]',
      title: "Tags are free-form",
      content:
        "Comma-separated, entirely yours: “flowering”, “edible”, “needs water”. They become filters in the gallery.",
      placement: "top",
    },
    {
      target: '[data-tour="entry-save"]',
      title: "Save when you're ready",
      content:
        "Photos upload and the entry lands in your garden. Nothing is sent anywhere but your Drive.",
      placement: "top",
    },
  ];
}

function relationshipSteps(controls: TourControls, aiVisible: boolean): Step[] {
  const steps: Step[] = [
    {
      target: '[data-tour="rel-canvas"]',
      title: "The relationship studio",
      content:
        "This is the food web behind the scenes. Drag from one organism to another to connect them — that link is what draws the web view.",
      skipBeacon: true,
      // The canvas fills the studio's fixed-inset portal, so there is no room
      // outside it to place a tooltip — an edge placement gets flipped off the
      // top of the viewport. Centered floats it over the spotlit canvas.
      placement: "center",
      before: async () => {
        controls.showWebView();
        await clickToOpen('[data-tour="web-edit"]');
        await waitForElement('[data-tour="rel-canvas"]');
      },
    },
    {
      target: '[data-tour="rel-connect"]',
      title: "Connect in bulk",
      content:
        "Dragging one link at a time gets old. Connect lets you pick a relationship type, then tick every organism it applies to at once.",
      placement: "bottom",
    },
    {
      target: '[data-tour="rel-add"]',
      title: "Pull in more organisms",
      content:
        "The canvas starts with what's already connected. Add organism brings anything else from your garden onto it.",
      placement: "bottom",
    },
    {
      target: '[data-tour="rel-types"]',
      title: "Define your own types",
      content:
        "“Pollinates”, “shades”, “competes with” — you name the relationships, and mark whether each one is directional.",
      // Pinned to the canvas's top-left, so it must open downwards — placing
      // above would flip off the top of the viewport.
      placement: "bottom",
    },
  ];

  if (aiVisible) {
    steps.splice(1, 0, {
      target: '[data-tour="rel-ai"]',
      title: "Or let a model draft it",
      content:
        "This builds a prompt describing your garden. Paste it into any chat model, paste the reply back, and it turns the suggestions into real links for you to review.",
      placement: "bottom",
    });
  }

  return steps;
}
