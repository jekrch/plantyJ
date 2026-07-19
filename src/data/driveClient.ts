import { getAccessToken, trySilentRefresh } from "./googleAuth";

/**
 * Minimal typed wrapper over the Google Drive v3 REST API. Pure fetch — no
 * gapi SDK. All calls carry the current OAuth token; a 401 triggers one
 * silent-refresh attempt before surfacing DriveAuthError.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export class DriveAuthError extends Error {}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  thumbnailLink?: string;
}

async function authFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new DriveAuthError("Not signed in");
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    if (retry && (await trySilentRefresh())) return authFetch(url, init, false);
    throw new DriveAuthError("Google session expired");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

export async function listFiles(q: string, fields = "id,name,mimeType"): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      pageSize: "1000",
      fields: `nextPageToken,files(${fields})`,
      spaces: "drive",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authFetch(`${API}/files?${params}`);
    const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const res = await authFetch(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return ((await res.json()) as { id: string }).id;
}

/** Find a folder by name (optionally under a parent), creating it if absent. */
export async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const found = await listFiles(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
    "id,name",
  );
  return found[0]?.id ?? createFolder(name, parentId);
}

export async function downloadJson<T>(fileId: string): Promise<T> {
  const res = await authFetch(`${API}/files/${fileId}?alt=media`);
  return res.json() as Promise<T>;
}

export async function createFile(
  name: string,
  parentId: string,
  content: Blob,
  fields = "id,name,thumbnailLink",
): Promise<DriveFile> {
  const boundary = `plantyj${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: [parentId] })}\r\n`,
    `--${boundary}\r\nContent-Type: ${content.type || "application/octet-stream"}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=${fields}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json() as Promise<DriveFile>;
}

export async function updateFileContent(fileId: string, content: Blob): Promise<void> {
  await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": content.type || "application/octet-stream" },
    body: content,
  });
}

export async function deleteFile(fileId: string): Promise<void> {
  await authFetch(`${API}/files/${fileId}`, { method: "DELETE" });
}
