import type { AIAnalysis } from "../types";
import { isWritable, loadJson, notifyDataChanged } from "./source";
import { driveSaveJson } from "./driveSource";
import { pairKey } from "./analysisAI";

/**
 * Browser write path for a Drive-backed garden's AI ecological analyses
 * (`ai_analysis.json`). The counterpart of the Telegram worker's `commitAnalyses`
 * ([worker/src/analyze.ts]): both upsert by `shortCode|zoneCode` and keep the
 * file sorted, so a browser-drafted analysis is byte-compatible with a
 * worker-generated one.
 */

function assertWritable(): void {
  if (!isWritable()) throw new Error("The founder's garden is read-only");
}

interface AnalysesFile {
  analyses?: AIAnalysis[];
}

/** One row per applied analysis, for the assist modal's preview list. */
export interface ApplyResult {
  key: string;
  ok: boolean;
  message: string;
}

/**
 * Persist a batch of drafted analyses. Each entry is upserted into
 * `ai_analysis.json` by `shortCode|zoneCode` (a re-draft overwrites the prior
 * one), the file is kept sorted, and `created` is stamped now. One
 * read-modify-write for the whole batch, mirroring the worker.
 */
export async function applyAnalyses(entries: AIAnalysis[]): Promise<ApplyResult[]> {
  assertWritable();
  const file = await loadJson<AnalysesFile>("ai_analysis.json");
  const merged = [...(file.analyses ?? [])];
  const now = new Date().toISOString();
  const results: ApplyResult[] = [];

  for (const e of entries) {
    const key = pairKey(e.shortCode, e.zoneCode);
    const entry: AIAnalysis = { ...e, created: now };
    const idx = merged.findIndex(
      (m) => m.shortCode === e.shortCode && m.zoneCode === e.zoneCode,
    );
    if (idx === -1) {
      merged.push(entry);
      results.push({ key, ok: true, message: `Added ${e.shortCode} @ ${e.zoneCode}` });
    } else {
      merged[idx] = entry;
      results.push({ key, ok: true, message: `Updated ${e.shortCode} @ ${e.zoneCode}` });
    }
  }

  merged.sort((a, b) =>
    a.shortCode === b.shortCode
      ? a.zoneCode.localeCompare(b.zoneCode)
      : a.shortCode.localeCompare(b.shortCode),
  );

  await driveSaveJson("ai_analysis.json", { analyses: merged });
  notifyDataChanged();
  return results;
}
