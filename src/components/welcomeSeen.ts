const SEEN_KEY = "plantyj:welcomed";

/**
 * Whether this browser has already been shown the welcome. Storage failures
 * (private mode, blocked cookies) count as "seen" so a browser that can't
 * remember the dismissal doesn't greet the visitor on every page load.
 *
 * Kept out of WelcomeModal.tsx so that App can ask the question without
 * statically importing the modal it is trying to load on demand.
 */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do — the visitor just sees the welcome again next time.
  }
}
