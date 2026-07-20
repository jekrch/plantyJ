import type { AiAnalysisEntry, Env } from "../types";
import { readJsonFile, readTextFile, writeJsonFile } from "./client";
import { AI_ANALYSIS_PATH, ROLLUP_PATH } from "./paths";

export async function readAiAnalyses(
  env: Env,
): Promise<{ analyses: AiAnalysisEntry[]; sha: string | null }> {
  const { data, sha } = await readJsonFile<{ analyses?: AiAnalysisEntry[] }>(
    env,
    AI_ANALYSIS_PATH,
    { analyses: [] },
  );
  return { analyses: data.analyses ?? [], sha };
}

export async function writeAiAnalyses(
  env: Env,
  analyses: AiAnalysisEntry[],
  sha: string | null,
  commitMessage: string,
): Promise<void> {
  await writeJsonFile(env, AI_ANALYSIS_PATH, { analyses }, sha, commitMessage);
}

// Reads rollup.min.json straight from the GitHub repo (the source of truth)
// rather than the deployed CDN copy at plantyj.com. compute-metadata.yml
// regenerates and commits this file as soon as pics/plants change, so reading
// it here means /analyze and /reassess see a newly-added specimen the moment
// the metadata commit lands — no waiting for the Pages deploy, and no risk of
// the Cloudflare/GitHub-Pages edge cache serving a stale rollup that omits the
// latest pair. Returns the raw JSON text (for embedding verbatim in the Gemini
// prompt); the caller parses it. Throws if the file can't be read.
export async function readRollupRaw(env: Env): Promise<string> {
  return readTextFile(env, ROLLUP_PATH);
}
