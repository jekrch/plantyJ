import type { Env, GitHubContentsResponse } from "../types";
import { base64ToUtf8, utf8ToBase64 } from "./encoding";
import { GITHUB_API, USER_AGENT } from "./paths";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
}

/** Contents-API URL for a repo-relative path. */
export function contentsUrl(env: Env, path: string): string {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  return `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
}

export function authHeaders(env: Env): Record<string, string> {
  return githubHeaders(env.GITHUB_TOKEN);
}

export async function commitFile(
  env: Env,
  path: string,
  base64Content: string,
  commitMessage: string,
): Promise<void> {
  const resp = await fetch(contentsUrl(env, path), {
    method: "PUT",
    headers: authHeaders(env),
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      branch: "main",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GitHub commit failed (${resp.status}): ${err}`);
  }
}

export async function readJsonFile<T>(
  env: Env,
  path: string,
  fallback: T,
): Promise<{ data: T; sha: string | null }> {
  const resp = await fetch(contentsUrl(env, path), { headers: authHeaders(env) });

  if (resp.status === 404) {
    return { data: fallback, sha: null };
  }
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to read ${path} (${resp.status}): ${err}`);
  }

  const meta: GitHubContentsResponse = await resp.json();
  const content = base64ToUtf8(meta.content.replace(/\n/g, ""));
  return { data: JSON.parse(content) as T, sha: meta.sha };
}

/** Raw file text, no JSON parse. Throws if the file can't be read. */
export async function readTextFile(env: Env, path: string): Promise<string> {
  const resp = await fetch(contentsUrl(env, path), { headers: authHeaders(env) });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to read ${path} (${resp.status}): ${err}`);
  }
  const meta: GitHubContentsResponse = await resp.json();
  return base64ToUtf8(meta.content.replace(/\n/g, ""));
}

export async function writeJsonFile(
  env: Env,
  path: string,
  body: unknown,
  sha: string | null,
  commitMessage: string,
): Promise<void> {
  const putBody: Record<string, string> = {
    message: commitMessage,
    content: utf8ToBase64(JSON.stringify(body, null, 2)),
    branch: "main",
  };
  if (sha) putBody.sha = sha;

  const resp = await fetch(contentsUrl(env, path), {
    method: "PUT",
    headers: authHeaders(env),
    body: JSON.stringify(putBody),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${path} update failed (${resp.status}): ${err}`);
  }
}

export async function deleteFile(
  env: Env,
  path: string,
  sha: string,
  commitMessage: string,
): Promise<void> {
  const resp = await fetch(contentsUrl(env, path), {
    method: "DELETE",
    headers: authHeaders(env),
    body: JSON.stringify({
      message: commitMessage,
      sha,
      branch: "main",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GitHub delete failed (${resp.status}): ${err}`);
  }
}

/**
 * Deleting through the Contents API needs the blob sha, so every delete is a
 * GET followed by a DELETE. A missing file is not an error — the JSON manifest
 * is the source of truth, and an image can legitimately already be gone.
 * Returns whether a file was actually deleted.
 */
export async function deleteFileIfExists(
  env: Env,
  path: string,
  commitMessage: string,
): Promise<boolean> {
  const resp = await fetch(contentsUrl(env, path), { headers: authHeaders(env) });
  if (!resp.ok) return false;
  const meta: GitHubContentsResponse = await resp.json();
  await deleteFile(env, path, meta.sha, commitMessage);
  return true;
}
