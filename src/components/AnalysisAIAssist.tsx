import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle, Sparkles, X } from "lucide-react";
import type { AIAnalysis } from "../types";
import {
  buildRollup,
  type GardenRollup,
} from "../data/relationshipAI";
import {
  buildAnalysisPrompt,
  findMissingAnalysisPairs,
  pairKey,
  parseAnalysisResponse,
  type AnalysisPair,
} from "../data/analysisAI";
import { applyAnalyses, type ApplyResult } from "../data/analysisMutations";
import { loadGardenDescription, saveGardenDescription } from "../data/gardenDescription";
import { updateZone } from "../data/mutations";
import { loadJson } from "../data/source";
import { Dropdown, type DropdownOption } from "./Dropdown";

interface Props {
  onClose: () => void;
  /** Called after analyses are applied so consumers can refresh. */
  onApplied: () => void;
}

const INPUT =
  "w-full rounded bg-white/5 border border-white/10 px-2.5 py-2 text-xs font-mono text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50";

const VERDICT_COLOR: Record<AIAnalysis["verdict"], string> = {
  GOOD: "text-emerald-300",
  MIXED: "text-amber-300",
  BAD: "text-rose-300",
};

const NONE = "__none__";

/**
 * Two-step "AI assist" for drafting ecological analyses: (1) pick up to two
 * specimen+zone pairs and a length, then copy a prompt (garden rollup + the
 * gardener's property description) into any chat model; (2) paste the model's
 * JSON reply back and apply the analyses it produced. The browser counterpart
 * of the Telegram worker's `/analyze`.
 */
export default function AnalysisAIAssist({ onClose, onApplied }: Props) {
  const [rollup, setRollup] = useState<GardenRollup | null>(null);
  const [existing, setExisting] = useState<AIAnalysis[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [description, setDescription] = useState("");
  const [savedDescription, setSavedDescription] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

  const [selected, setSelected] = useState<[string, string]>([NONE, NONE]);
  const [paragraphs, setParagraphs] = useState<1 | 2>(2);

  const [copied, setCopied] = useState(false);
  const [response, setResponse] = useState("");
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);

  // Inline zone-description editing keyed by zoneCode.
  const [zoneDrafts, setZoneDrafts] = useState<Record<string, string>>({});
  const [savingZone, setSavingZone] = useState<string | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);

  const reload = useMemo(
    () => async () => {
      const [rup, aiFile] = await Promise.all([
        buildRollup(),
        loadJson<{ analyses?: AIAnalysis[] }>("ai_analysis.json"),
      ]);
      setRollup(rup);
      setExisting(aiFile.analyses ?? []);
      return rup;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([reload(), loadGardenDescription()])
      .then(([, gd]) => {
        if (cancelled) return;
        setDescription(gd.description ?? "");
        setSavedDescription(gd.description ?? "");
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const missing = useMemo(
    () => (rollup ? findMissingAnalysisPairs(rollup, existing) : []),
    [rollup, existing],
  );

  // Default the two slots to the first two missing pairs once loaded.
  useEffect(() => {
    if (!rollup) return;
    setSelected([missing[0] ? pairKey(missing[0].shortCode, missing[0].zoneCode) : NONE,
      missing[1] ? pairKey(missing[1].shortCode, missing[1].zoneCode) : NONE]);
    // Only when the missing set first materializes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollup]);

  // Friendly labels for a pair, e.g. "Tomato @ Back bed".
  const labelFor = useMemo(() => {
    const plantName = new Map<string, string>();
    const zoneName = new Map<string, string>();
    for (const p of rollup?.plants ?? []) {
      plantName.set(p.shortCode, p.commonName || p.fullName || p.shortCode);
    }
    for (const z of rollup?.zones ?? []) zoneName.set(z.code, z.name || z.code);
    return (shortCode: string, zoneCode: string) =>
      `${plantName.get(shortCode) ?? shortCode} @ ${zoneName.get(zoneCode) ?? zoneCode}`;
  }, [rollup]);

  const pairOptions = useMemo<DropdownOption[]>(
    () =>
      missing.map((p) => ({
        value: pairKey(p.shortCode, p.zoneCode),
        label: labelFor(p.shortCode, p.zoneCode),
        hint: p.zoneCode,
      })),
    [missing, labelFor],
  );

  const parsePairKey = (key: string): AnalysisPair | null => {
    if (key === NONE) return null;
    const [shortCode, zoneCode] = key.split("|");
    return shortCode && zoneCode ? { shortCode, zoneCode } : null;
  };

  // The distinct pairs the two slots resolve to (slot 2 may repeat slot 1 or be none).
  const selectedPairs = useMemo(() => {
    const out: AnalysisPair[] = [];
    const seen = new Set<string>();
    for (const key of selected) {
      const p = parsePairKey(key);
      if (p && !seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
    return out;
  }, [selected]);

  // Zones among the selected pairs that still lack a description — worth an invite.
  const undescribedZones = useMemo(() => {
    const byCode = new Map(rollup?.zones.map((z) => [z.code, z]) ?? []);
    const codes = new Set(selectedPairs.map((p) => p.zoneCode));
    return [...codes].filter((c) => !byCode.get(c)?.description).sort();
  }, [rollup, selectedPairs]);

  const prompt = useMemo(() => {
    if (!rollup || selectedPairs.length === 0) return null;
    return buildAnalysisPrompt(rollup, {
      pairs: selectedPairs,
      paragraphs,
      gardenDescription: savedDescription || null,
    });
  }, [rollup, selectedPairs, paragraphs, savedDescription]);

  const allowedKeys = useMemo(
    () => new Set(selectedPairs.map((p) => pairKey(p.shortCode, p.zoneCode))),
    [selectedPairs],
  );
  const parsed = useMemo(
    () => (response.trim() ? parseAnalysisResponse(response, allowedKeys) : null),
    [response, allowedKeys],
  );

  const descDirty = description.trim() !== savedDescription.trim();

  const saveDesc = async () => {
    setSavingDesc(true);
    try {
      const saved = await saveGardenDescription(description);
      setSavedDescription(saved.description ?? "");
    } catch {
      // keep the draft; a transient Drive error shouldn't lose their text
    } finally {
      setSavingDesc(false);
    }
  };

  const saveZone = async (code: string) => {
    const text = (zoneDrafts[code] ?? "").trim();
    if (!text) return;
    setSavingZone(code);
    try {
      await updateZone(code, { description: text });
      await reload();
      setZoneDrafts((d) => {
        const next = { ...d };
        delete next[code];
        return next;
      });
    } catch {
      // leave the draft in place so the user can retry
    } finally {
      setSavingZone(null);
    }
  };

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
    if (!parsed || parsed.analyses.length === 0) return;
    setApplying(true);
    try {
      const res = await applyAnalyses(parsed.analyses);
      setResults(res);
      if (res.some((r) => r.ok)) {
        onApplied();
        await reload();
      }
    } catch (err) {
      setResults([{ key: "", ok: false, message: err instanceof Error ? err.message : "Failed" }]);
    } finally {
      setApplying(false);
    }
  };

  const applied = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-black/70"
      onClick={applying ? undefined : onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col bg-surface border border-ink-faint/30 rounded-t-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0 px-5 pt-5 pb-4">
          <h2 className="flex items-center gap-2 font-display text-sm uppercase tracking-widest text-ink">
            <Sparkles size={15} className="text-accent" /> Draft analyses with a model
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

        <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-5 pb-5 space-y-4">
        {loadError ? (
          <p className="text-xs text-rose-300">{loadError}</p>
        ) : !rollup ? (
          <div className="flex items-center gap-2 h-40 justify-center text-ink-muted text-xs">
            <LoaderCircle size={14} className="animate-spin" /> Building rollup…
          </div>
        ) : (
          <>
            {/* Garden description */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-widest text-ink-muted font-display">
                  Your garden
                </p>
                <button
                  onClick={saveDesc}
                  disabled={savingDesc || !descDirty}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-ink-muted text-[11px] font-display uppercase tracking-wider transition-colors disabled:opacity-40"
                >
                  {savingDesc ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
                  {descDirty ? "Save" : "Saved"}
                </button>
              </div>
              <p className="text-[11px] text-ink-faint">
                Location and property conditions — hardiness zone, soil, sun, your priorities. Saved
                to your garden and woven into every prompt so the model grounds its verdicts in your
                actual site.
              </p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Minneapolis, MN — USDA zone 4b/5a, clay/loam soil, NW corner lot with afternoon shade. We prioritize natives, edibles, and pollinator habitat."
                className={`${INPUT} h-20 resize-none`}
              />
            </section>

            {/* Pair picker + length */}
            <section className="space-y-2">
              <p className="text-[11px] uppercase tracking-widest text-ink-muted font-display">
                Analyze — pick up to two
              </p>
              {missing.length === 0 ? (
                <p className="text-[11px] text-ink-faint italic">
                  Every specimen in every zone already has an analysis. Add more journal entries to
                  get new pairs.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Dropdown
                      value={selected[0]}
                      options={[{ value: NONE, label: "— none —" }, ...pairOptions]}
                      onChange={(v) => setSelected(([, b]) => [v, b])}
                      placeholder="First pair"
                    />
                    <Dropdown
                      value={selected[1]}
                      options={[{ value: NONE, label: "— none —" }, ...pairOptions]}
                      onChange={(v) => setSelected(([a]) => [a, v])}
                      placeholder="Second pair (optional)"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-ink-faint">
                      {missing.length} pair{missing.length === 1 ? "" : "s"} still missing
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-ink-muted mr-1">Length</span>
                      {([1, 2] as const).map((n) => (
                        <button
                          key={n}
                          onClick={() => setParagraphs(n)}
                          className={`px-2 py-0.5 rounded text-[11px] font-display uppercase tracking-wider transition-colors ${
                            paragraphs === n
                              ? "bg-accent/25 text-accent"
                              : "bg-white/5 text-ink-muted hover:text-ink"
                          }`}
                        >
                          {n} para{n === 1 ? "" : "s"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Zone-description invite */}
              {undescribedZones.length > 0 && (
                <div className="rounded border border-amber-400/20 bg-amber-400/5 p-2.5 space-y-2">
                  <p className="text-[11px] text-amber-200/90">
                    {undescribedZones.length === 1 ? "This zone has" : "These zones have"} no
                    description. Adding one (sun, moisture, soil, what's nearby) sharpens the
                    analysis — optional.
                  </p>
                  {undescribedZones.map((code) => (
                    <div key={code} className="flex items-start gap-2">
                      <textarea
                        value={zoneDrafts[code] ?? ""}
                        onChange={(e) =>
                          setZoneDrafts((d) => ({ ...d, [code]: e.target.value }))
                        }
                        placeholder={`Describe zone ${code}…`}
                        className={`${INPUT} h-12 resize-none flex-1`}
                      />
                      <button
                        onClick={() => saveZone(code)}
                        disabled={savingZone === code || !(zoneDrafts[code] ?? "").trim()}
                        className="mt-0.5 flex items-center gap-1 px-2.5 py-1.5 rounded bg-white/5 hover:bg-white/10 text-ink-muted text-[11px] font-display uppercase tracking-wider transition-colors disabled:opacity-40 shrink-0"
                      >
                        {savingZone === code ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        Save
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
              {prompt ? (
                <textarea
                  ref={promptRef}
                  readOnly
                  value={prompt}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${INPUT} h-32 resize-none`}
                />
              ) : (
                <p className="text-[11px] text-ink-faint italic">
                  Pick at least one pair above to build the prompt.
                </p>
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
                placeholder={'[\n  { "shortCode": "…", "zoneCode": "…", "verdict": "GOOD", "analysis": "…", "references": [] }\n]'}
                className={`${INPUT} h-28 resize-none`}
              />

              {parsed && (
                <div className="rounded border border-white/10 bg-white/3 divide-y divide-white/5 max-h-52 overflow-y-auto thin-scroll">
                  {parsed.analyses.length === 0 && parsed.errors.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-ink-faint italic">
                      No analyses found yet.
                    </p>
                  ) : (
                    <>
                      {parsed.analyses.map((a) => {
                        const key = pairKey(a.shortCode, a.zoneCode);
                        const r = results?.find((rr) => rr.key === key);
                        return (
                          <div key={`a-${key}`} className="flex items-center gap-2 px-3 py-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                r ? (r.ok ? "bg-emerald-400" : "bg-rose-400") : "bg-accent/70"
                              }`}
                            />
                            <span className="text-[11px] text-ink truncate flex-1">
                              {labelFor(a.shortCode, a.zoneCode)}
                            </span>
                            <span
                              className={`text-[10px] font-mono uppercase tracking-wide shrink-0 ${VERDICT_COLOR[a.verdict]}`}
                            >
                              {a.verdict}
                            </span>
                          </div>
                        );
                      })}
                      {parsed.errors.map((e, i) => (
                        <div key={`e-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 shrink-0" />
                          <code className="text-[11px] font-mono text-ink-muted truncate flex-1">
                            {e.raw}
                          </code>
                          <span
                            className="text-[10px] text-amber-300/80 shrink-0"
                            title={e.error}
                          >
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
                  Applied <span className="text-emerald-300">{applied}</span>. Close to see them on
                  each organism.
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
                disabled={applying || !parsed || parsed.analyses.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent/20 hover:bg-accent/30 text-accent text-xs font-display uppercase tracking-wider transition-colors disabled:opacity-40"
              >
                {applying && <LoaderCircle size={13} className="animate-spin" />}
                {parsed && parsed.analyses.length > 0
                  ? `Apply ${parsed.analyses.length} analys${parsed.analyses.length === 1 ? "is" : "es"}`
                  : "Apply"}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
