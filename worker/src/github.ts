import type { Env, Gallery, GitHubContentsResponse, PlantEntry } from "./types";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "plantyj-bot";
const PLANTS_PATH = "public/data/plants.json";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function commitFile(
  env: Env,
  path: string,
  base64Content: string,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
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

export async function readPlantsJson(
  env: Env
): Promise<{ gallery: Gallery; sha: string | null }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${PLANTS_PATH}`;

  const getResp = await fetch(url, {
    headers: githubHeaders(env.GITHUB_TOKEN),
  });

  let gallery: Gallery = { plants: [] };
  let sha: string | null = null;

  if (getResp.ok) {
    const data: GitHubContentsResponse = await getResp.json();
    sha = data.sha;
    const content = atob(data.content.replace(/\n/g, ""));
    gallery = JSON.parse(content);
  } else if (getResp.status !== 404) {
    const err = await getResp.text();
    throw new Error(`Failed to read plants.json (${getResp.status}): ${err}`);
  }

  return { gallery, sha };
}

async function writePlantsJson(
  env: Env,
  gallery: Gallery,
  sha: string | null,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${PLANTS_PATH}`;

  const updatedContent = btoa(JSON.stringify(gallery, null, 2));

  const putBody: Record<string, string> = {
    message: commitMessage,
    content: updatedContent,
    branch: "main",
  };
  if (sha) putBody.sha = sha;

  const putResp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify(putBody),
  });

  if (!putResp.ok) {
    const err = await putResp.text();
    throw new Error(`plants.json update failed (${putResp.status}): ${err}`);
  }
}

export function nextSeq(gallery: Gallery): number {
  let max = 0;
  for (const p of gallery.plants) {
    if (p.seq && p.seq > max) max = p.seq;
  }
  return max + 1;
}

export async function appendPlant(
  env: Env,
  newEntry: PlantEntry
): Promise<void> {
  const { gallery, sha } = await readPlantsJson(env);
  gallery.plants.unshift(newEntry);
  await writePlantsJson(
    env,
    gallery,
    sha,
    `Add plant: ${newEntry.shortCode}`
  );
}

async function deleteFile(
  env: Env,
  path: string,
  sha: string,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, {
    method: "DELETE",
    headers: githubHeaders(env.GITHUB_TOKEN),
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

export async function deletePlant(
  env: Env,
  seq: number
): Promise<PlantEntry | null> {
  const { gallery, sha } = await readPlantsJson(env);
  const idx = gallery.plants.findIndex((p) => p.seq === seq);
  if (idx === -1) return null;

  const [removed] = gallery.plants.splice(idx, 1);

  await writePlantsJson(
    env,
    gallery,
    sha,
    `Remove plant: ${removed.shortCode} (#${removed.seq})`
  );

  const imagePath = `public/${removed.image}`;
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const fileUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${imagePath}`;
  const fileResp = await fetch(fileUrl, {
    headers: githubHeaders(env.GITHUB_TOKEN),
  });
  if (fileResp.ok) {
    const fileData: GitHubContentsResponse = await fileResp.json();
    await deleteFile(
      env,
      imagePath,
      fileData.sha,
      `Delete image: ${removed.shortCode} (#${removed.seq})`
    );
  }

  return removed;
}

const UPDATABLE_FIELDS = [
  "shortCode",
  "fullName",
  "commonName",
  "zoneCode",
  "zoneName",
  "tags",
  "description",
] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field);
}

export async function updatePlant(
  env: Env,
  seq: number,
  field: string,
  value: string
): Promise<PlantEntry | null> {
  if (!isUpdatableField(field)) {
    throw new Error(
      `Cannot update "${field}". Updatable fields: ${UPDATABLE_FIELDS.join(", ")}`
    );
  }

  const { gallery, sha } = await readPlantsJson(env);
  const plant = gallery.plants.find((p) => p.seq === seq);
  if (!plant) return null;

  switch (field) {
    case "shortCode":
      plant.shortCode = value;
      break;
    case "fullName":
      plant.fullName = value || null;
      break;
    case "commonName":
      plant.commonName = value || null;
      break;
    case "zoneCode":
      plant.zoneCode = value;
      break;
    case "zoneName":
      plant.zoneName = value || null;
      break;
    case "tags":
      plant.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      break;
    case "description":
      plant.description = value || null;
      break;
  }

  await writePlantsJson(
    env,
    gallery,
    sha,
    `Update plant ${plant.shortCode} (#${plant.seq}): ${field}`
  );

  return plant;
}
