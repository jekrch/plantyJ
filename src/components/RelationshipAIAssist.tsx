import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle, Sparkles, X } from "lucide-react";
import {
  buildRelationshipPrompt,
  buildRollup,
  parseRelationshipCommands,
} from "../data/relationshipAI";
import { applyRelationshipCommands, type CommandResult } from "../data/relationshipMutations";

interface Props {
  /** Real organism shortCodes — `/relate` endpoints are validated against these. */
  knownCodes: Set<string>;
  onClose: () => void;
  /** Called after commands are applied so the graph can refresh. */
  onApplied: () => void;
}

const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-2 text-xs font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";

/**
 * Two-step "AI assist" flow: (1) generate a prompt containing the garden rollup
 * + command grammar to paste into any chat model; (2) paste the model's reply
 * back and apply the `/relate` · `/reltype` commands it produced.
 */
export default function RelationshipAIAssist({ knownCodes, onClose, onApplied }: Props) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [response, setResponse] = useState("");
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<CommandResult[] | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    buildRollup()
      .then((rollup) => !cancelled && setPrompt(buildRelationshipPrompt(rollup)))
      .catch((err) => !cancelled && setBuildError(err instanceof Error ? err.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = useMemo(
    () => (response.trim() ? parseRelationshipCommands(response) : null),
    [response],
  );

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      promptRef.current?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const apply = async () => {
    if (!parsed || parsed.commands.length === 0) return;
    setApplying(true);
    try {
      const res = await applyRelationshipCommands(parsed.commands, knownCodes);
      setResults(res);
      if (res.some((r) => r.ok)) onApplied();
    } catch (err) {
      setResults([{ raw: "", ok: false, message: err instanceof Error ? err.message : "Failed" }]);
    } finally {
      setApplying(false);
    }
  };

  const applied = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-black/70"
      onClick={applying ? undefined : onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto thin-scroll bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-sm uppercase tracking-widest text-ink">
            <Sparkles size={15} className="text-accent" /> Build relationships with a model
          </h2>
          <button
            onClick={onClose}
            disabled={applying}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Step 1 — prompt */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-ink-muted font-display">
              1 · Copy this prompt into your model
            </p>
            <button
              onClick={copyPrompt}
              disabled={!prompt}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/20 hover:bg-accent/30 text-accent text-[11px] font-display uppercase tracking-wider transition-colors disabled:opacity-40"
            >
              {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-[11px] text-ink-faint">
            It bundles a rollup of your garden (organisms, zones, existing relationships) with the
            command format the model must reply in — works with Claude, ChatGPT, Gemini, or any
            chat model.
          </p>
          {buildError ? (
            <p className="text-xs text-rose-300">{buildError}</p>
          ) : prompt ? (
            <textarea
              ref={promptRef}
              readOnly
              value={prompt}
              onFocus={(e) => e.currentTarget.select()}
              className={`${INPUT} h-40 resize-none`}
            />
          ) : (
            <div className="flex items-center gap-2 h-40 justify-center text-ink-muted text-xs">
              <LoaderCircle size={14} className="animate-spin" /> Building rollup…
            </div>
          )}
        </section>

        {/* Step 2 — response */}
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-ink-muted font-display">
            2 · Paste the model's reply
          </p>
          <textarea
            value={response}
            onChange={(e) => {
              setResponse(e.target.value);
              setResults(null);
            }}
            placeholder={"/relate pollinates // honeybee // borage // f\n/relate companion // tomato // basil // u"}
            className={`${INPUT} h-32 resize-none`}
          />

          {parsed && (
            <div className="rounded border border-white/10 bg-white/3 divide-y divide-white/5 max-h-52 overflow-y-auto thin-scroll">
              {parsed.commands.length === 0 && parsed.errors.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink-faint italic">
                  No commands found yet.
                </p>
              ) : (
                <>
                  {parsed.commands.map((c, i) => {
                    const r = results?.find((rr) => rr.raw === c.raw);
                    return (
                      <div key={`c-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            r ? (r.ok ? "bg-emerald-400" : "bg-rose-400") : "bg-accent/70"
                          }`}
                        />
                        <code className="text-[11px] font-mono text-ink truncate flex-1">
                          {c.raw}
                        </code>
                        {r && (
                          <span
                            className={`text-[10px] shrink-0 ${r.ok ? "text-emerald-300" : "text-rose-300"}`}
                            title={r.message}
                          >
                            {r.ok ? "✓" : r.message}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {parsed.errors.map((e, i) => (
                    <div key={`e-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 shrink-0" />
                      <code className="text-[11px] font-mono text-ink-muted truncate flex-1">
                        {e.raw}
                      </code>
                      <span className="text-[10px] text-amber-300/80 shrink-0" title={e.error}>
                        skipped
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {results && (
            <p className="text-[11px] text-ink-muted">
              Applied <span className="text-emerald-300">{applied}</span>
              {failed > 0 && (
                <>
                  {" · "}
                  <span className="text-rose-300">{failed} failed</span>
                </>
              )}
              . Close to see them on the canvas.
            </p>
          )}
        </section>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition-colors"
          >
            {results ? "Done" : "Cancel"}
          </button>
          <button
            onClick={apply}
            disabled={applying || !parsed || parsed.commands.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
          >
            {applying && <LoaderCircle size={13} className="animate-spin" />}
            {parsed && parsed.commands.length > 0
              ? `Apply ${parsed.commands.length} command${parsed.commands.length === 1 ? "" : "s"}`
              : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
