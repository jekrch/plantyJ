import { useEffect, useState } from "react";
import { areAIFeaturesHidden, loadProfile, PROFILE_CHANGED_EVENT } from "../data/profile";
import { isDriveMode } from "../data/source";
import { getSessionUser } from "../data/googleAuth";

/**
 * Whether model-assisted features should be shown to the current user. Cloud
 * users can opt out in their account settings; the founder's static garden has
 * no account, so it always shows them.
 *
 * Reads the localStorage mirror synchronously on first render (see
 * `profile.ts`) and re-renders once the real profile lands, so an opted-out
 * user never sees the features flash in.
 */
export function useAIFeaturesVisible(): boolean {
  const [hidden, setHidden] = useState(areAIFeaturesHidden);

  useEffect(() => {
    const sync = () => setHidden(areAIFeaturesHidden());
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    // Kick the (cached) load so the preference is authoritative even if the
    // account menu was never opened this session.
    if (isDriveMode() && getSessionUser()) loadProfile().then(sync).catch(() => {});
    return () => window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
  }, []);

  return !hidden;
}
