import { useEffect, useRef, useState } from "react";
import { Check, Cloud, LogOut } from "lucide-react";
import { getSourceMode, setSourceMode } from "../data/source";
import { AUTH_CHANGED_EVENT, getSessionUser, signOut } from "../data/googleAuth";

/**
 * Header dropdown for switching between the static demo garden and the
 * signed-in user's Drive-backed garden, plus session controls.
 */
export default function SourceMenu() {
  const [open, setOpen] = useState(false);
  const [, setAuthTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const mode = getSourceMode();
  const user = getSessionUser();

  useEffect(() => {
    const bump = () => setAuthTick((t) => t + 1);
    window.addEventListener(AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const optionCls =
    "w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-white/5 transition-colors cursor-pointer";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center h-8 w-8 rounded-md text-ink-muted hover:text-ink hover:bg-white/5 transition-colors"
        title="Choose garden"
        aria-label="Choose garden"
        aria-expanded={open}
      >
        <Cloud
          size={20}
          strokeWidth={1.5}
          className={mode === "drive" ? "text-accent" : undefined}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-md border border-ink-faint/30 bg-surface shadow-xl py-1">
          <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-ink-muted font-display">
            Garden
          </p>
          <button className={optionCls} onClick={() => setSourceMode("static")}>
            <span className="w-4">{mode === "static" && <Check size={14} />}</span>
            Founder's garden (plantyj.com)
          </button>
          <button className={optionCls} onClick={() => setSourceMode("drive")}>
            <span className="w-4">{mode === "drive" && <Check size={14} />}</span>
            My garden (Google Drive)
          </button>
          {mode === "drive" && user && (
            <>
              <div className="my-1 border-t border-ink-faint/20" />
              <p className="px-3 py-1.5 text-[11px] text-ink-muted truncate" title={user.email}>
                {user.email || user.name}
              </p>
              <button
                className={optionCls}
                onClick={() => {
                  signOut();
                  setOpen(false);
                }}
              >
                <span className="w-4">
                  <LogOut size={13} />
                </span>
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
