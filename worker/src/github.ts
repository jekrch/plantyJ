import type {
  AiAnalysisEntry,
  AnnotationEntry,
  Env,
  Gallery,
  GitHubContentsResponse,
  PicEntry,
  PlantRecord,
  RelationshipsFile,
  Zone,
  ZonePicEntry,
} from "./types";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "plantyj-bot";
const PICS_PATH = "public/data/pics.json";
const PLANTS_PATH = "public/data/plants.json";
const ZONES_PATH = "public/data/zones.json";
const ZONE_PICS_PATH = "public/data/zone_pics.json";
const ANNOTATIONS_PATH = "public/data/annotations.json";
const AI_ANALYSIS_PATH = "public/data/ai_analysis.json";
const RELATIONSHIPS_PATH = "public/data/relationships.json";

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunk to avoid blowing the call stack on large payloads.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// btoa only handles Latin-1, so any non-ASCII char (em-dashes, smart quotes,
// accented species names, etc.) raises an InvalidCharacterError. Always go
// through TextEncoder so the file bytes are valid UTF-8 on disk.
function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
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

async function readJsonFile<T>(
  env: Env,
  path: string,
  fallback: T
): Promise<{ data: T; sha: string | null }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, { headers: githubHeaders(env.GITHUB_TOKEN) });

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

async function writeJsonFile(
  env: Env,
  path: string,
  body: unknown,
  sha: string | null,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const updatedContent = utf8ToBase64(JSON.stringify(body, null, 2));

  const putBody: Record<string, string> = {
    message: commitMessage,
    content: updatedContent,
    branch: "main",
  };
  if (sha) putBody.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify(putBody),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${path} update failed (${resp.status}): ${err}`);
  }
}

interface ReadResult {
  gallery: Gallery;
  picsSha: string | null;
  plantsSha: string | null;
  zonesSha: string | null;
  zonePicsSha: string | null;
}

export async function readGallery(env: Env): Promise<ReadResult> {
  const [picsRes, plantsRes, zonesRes, zonePicsRes] = await Promise.all([
    readJsonFile<{ pics?: PicEntry[] }>(env, PICS_PATH, { pics: [] }),
    readJsonFile<{ plants?: PlantRecord[] }>(env, PLANTS_PATH, { plants: [] }),
    readJsonFile<{ zones?: Zone[] }>(env, ZONES_PATH, { zones: [] }),
    readJsonFile<{ zonePics?: ZonePicEntry[] }>(env, ZONE_PICS_PATH, { zonePics: [] }),
  ]);

  return {
    gallery: {
      pics: picsRes.data.pics ?? [],
      plants: plantsRes.data.plants ?? [],
      zones: zonesRes.data.zones ?? [],
      zonePics: zonePicsRes.data.zonePics ?? [],
    },
    picsSha: picsRes.sha,
    plantsSha: plantsRes.sha,
    zonesSha: zonesRes.sha,
    zonePicsSha: zonePicsRes.sha,
  };
}

export function nextSeq(gallery: Gallery): number {
  let max = 0;
  for (const p of gallery.pics) {
    if (p.seq && p.seq > max) max = p.seq;
  }
  return max + 1;
}

function applyZoneUpserts(zones: Zone[], upserts: Zone[]): Zone[] {
  const next = [...zones];
  for (const u of upserts) {
    const idx = next.findIndex((z) => z.code === u.code);
    if (idx === -1) next.push(u);
    else next[idx] = { ...next[idx], name: u.name ?? next[idx].name };
  }
  return next;
}

function upsertPlantRecord(plants: PlantRecord[], upsert: PlantRecord): PlantRecord[] {
  const next = [...plants];
  const idx = next.findIndex((p) => p.shortCode === upsert.shortCode);
  if (idx === -1) next.unshift(upsert);
  else next[idx] = upsert;
  return next;
}

export async function appendPic(
  env: Env,
  newPic: PicEntry,
  plantUpsert: PlantRecord | null,
  zoneUpserts: Zone[] = []
): Promise<void> {
  const { gallery, picsSha, plantsSha, zonesSha } = await readGallery(env);

  if (zoneUpserts.length > 0) {
    const nextZones = applyZoneUpserts(gallery.zones, zoneUpserts);
    await writeJsonFile(
      env,
      ZONES_PATH,
      { zones: nextZones },
      zonesSha,
      `Add zone(s): ${zoneUpserts.map((z) => z.code).join(", ")}`
    );
  }

  if (plantUpsert) {
    const nextPlants = upsertPlantRecord(gallery.plants, plantUpsert);
    await writeJsonFile(
      env,
      PLANTS_PATH,
      { plants: nextPlants },
      plantsSha,
      `Add/update plant: ${plantUpsert.shortCode} [skip-deploy]`
    );
  }

  const nextPics = [newPic, ...gallery.pics];
  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: nextPics },
    picsSha,
    `Add pic: ${newPic.shortCode} [skip-deploy]`
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

export async function deletePic(env: Env, seq: number): Promise<PicEntry | null> {
  const { gallery, picsSha } = await readGallery(env);
  const idx = gallery.pics.findIndex((p) => p.seq === seq);
  if (idx === -1) return null;

  const [removed] = gallery.pics.splice(idx, 1);

  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: gallery.pics },
    picsSha,
    `Remove pic: ${removed.shortCode} (#${removed.seq})`
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

const PIC_FIELDS = ["zoneCode", "tags", "description"] as const;
const PLANT_FIELDS = ["shortCode", "fullName", "commonName", "variety"] as const;
const UPDATABLE_FIELDS = [...PLANT_FIELDS, ...PIC_FIELDS] as const;

type PicField = (typeof PIC_FIELDS)[number];
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export const UPDATABLE_FIELD_LIST = UPDATABLE_FIELDS;

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field);
}

function isPicField(field: UpdatableField): field is PicField {
  return (PIC_FIELDS as readonly string[]).includes(field);
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export interface UpdateResult {
  pic: PicEntry;
  plant: PlantRecord | null;
}

/**
 * Update a field on the pic with the given seq, or on its associated plant
 * record. shortCode rename cascades to all pics referencing the old code.
 */
export async function updateBySeq(
  env: Env,
  seq: number,
  field: string,
  value: string
): Promise<UpdateResult | null> {
  if (!isUpdatableField(field)) {
    throw new Error(
      `Cannot update "${field}". Updatable fields: ${UPDATABLE_FIELDS.join(", ")}`
    );
  }

  const { gallery, picsSha, plantsSha, zonesSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;

  if (isPicField(field)) {
    switch (field) {
      case "zoneCode": {
        const code = value.trim();
        if (!code) throw new Error("zoneCode must be a non-empty zone code.");
        if (code.includes(",") || code.includes("+")) {
          throw new Error("zoneCode is a single value — a picture belongs to one zone.");
        }
        if (!gallery.zones.some((z) => z.code === code)) {
          const nextZones = [...gallery.zones, { code, name: null }];
          await writeJsonFile(
            env,
            ZONES_PATH,
            { zones: nextZones },
            zonesSha,
            `Add zone: ${code}`
          );
        }
        pic.zoneCode = code;
        break;
      }
      case "tags":
        pic.tags = parseList(value);
        break;
      case "description":
        pic.description = value || null;
        break;
    }

    await writeJsonFile(
      env,
      PICS_PATH,
      { pics: gallery.pics },
      picsSha,
      `Update pic ${pic.shortCode} (#${pic.seq}): ${field}`
    );

    const plant = gallery.plants.find((p) => p.shortCode === pic.shortCode) ?? null;
    return { pic, plant };
  }

  // Plant-level field — operate on the plant record keyed by pic.shortCode.
  const plantIdx = gallery.plants.findIndex((p) => p.shortCode === pic.shortCode);
  if (plantIdx === -1) {
    throw new Error(
      `Plant "${pic.shortCode}" not found in plants.json — cannot update ${field}.`
    );
  }
  const plant = gallery.plants[plantIdx];

  switch (field) {
    case "shortCode": {
      const newCode = value.trim();
      if (!newCode) throw new Error("shortCode must be non-empty.");
      if (newCode === plant.shortCode) {
        return { pic, plant };
      }
      if (gallery.plants.some((p) => p.shortCode === newCode)) {
        throw new Error(`shortCode "${newCode}" already exists.`);
      }
      const oldCode = plant.shortCode;
      plant.shortCode = newCode;
      // Cascade: re-point every pic that referenced the old code.
      for (const p of gallery.pics) {
        if (p.shortCode === oldCode) p.shortCode = newCode;
      }
      await writeJsonFile(
        env,
        PLANTS_PATH,
        { plants: gallery.plants },
        plantsSha,
        `Rename plant: ${oldCode} → ${newCode}`
      );
      await writeJsonFile(
        env,
        PICS_PATH,
        { pics: gallery.pics },
        picsSha,
        `Re-point pics: ${oldCode} → ${newCode}`
      );
      return { pic, plant };
    }
    case "fullName":
      plant.fullName = value || null;
      break;
    case "commonName":
      plant.commonName = value || null;
      break;
    case "variety":
      plant.variety = value || null;
      break;
  }

  await writeJsonFile(
    env,
    PLANTS_PATH,
    { plants: gallery.plants },
    plantsSha,
    `Update plant ${plant.shortCode}: ${field}`
  );

  return { pic, plant };
}

export interface AcceptResult {
  pic: PicEntry;
  plant: PlantRecord;
  renamedFrom: string | null;
}

/**
 * Accept the BioCLIP prediction on a pic: ensure a plant record exists with
 * the predicted fullName/commonName, optionally renaming the pic's shortCode
 * (e.g. `unid-7` → `r-rub`). When merging into an existing plant record,
 * existing fields are preserved — never overwritten.
 */
export async function acceptBioclip(
  env: Env,
  seq: number,
  targetShortCode: string | null
): Promise<AcceptResult | "no-pic" | "no-prediction"> {
  const { gallery, picsSha, plantsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return "no-pic";

  const speciesId = pic.bioclipSpeciesId?.trim() || null;
  const commonName = pic.bioclipCommonName?.trim() || null;
  if (!speciesId && !commonName) return "no-prediction";

  const newCode = targetShortCode?.trim() || null;
  const oldCode = pic.shortCode;
  const finalCode = newCode ?? oldCode;

  let plantsChanged = false;
  let picsChanged = false;
  let renamedFrom: string | null = null;

  if (newCode && newCode !== oldCode) {
    renamedFrom = oldCode;
    for (const p of gallery.pics) {
      if (p.shortCode === oldCode) {
        p.shortCode = newCode;
        picsChanged = true;
      }
    }
    // If a plant record existed at the old (unidentified) code, drop it —
    // the meaningful record now lives at finalCode.
    const oldPlantIdx = gallery.plants.findIndex((p) => p.shortCode === oldCode);
    if (oldPlantIdx !== -1) {
      gallery.plants.splice(oldPlantIdx, 1);
      plantsChanged = true;
    }
  }

  const existingIdx = gallery.plants.findIndex((p) => p.shortCode === finalCode);
  let plant: PlantRecord;
  if (existingIdx === -1) {
    plant = {
      shortCode: finalCode,
      fullName: speciesId,
      commonName: commonName,
    };
    gallery.plants.unshift(plant);
    plantsChanged = true;
  } else {
    const existing = gallery.plants[existingIdx];
    const merged: PlantRecord = {
      shortCode: finalCode,
      fullName: existing.fullName ?? speciesId,
      commonName: existing.commonName ?? commonName,
    };
    if (
      merged.fullName !== existing.fullName ||
      merged.commonName !== existing.commonName
    ) {
      gallery.plants[existingIdx] = merged;
      plantsChanged = true;
    }
    plant = merged;
  }

  if (plantsChanged) {
    await writeJsonFile(
      env,
      PLANTS_PATH,
      { plants: gallery.plants },
      plantsSha,
      renamedFrom
        ? `Accept BioCLIP: ${renamedFrom} → ${finalCode}`
        : `Accept BioCLIP: ${finalCode}`
    );
  }

  if (picsChanged) {
    await writeJsonFile(
      env,
      PICS_PATH,
      { pics: gallery.pics },
      picsSha,
      `Re-point pics: ${renamedFrom} → ${finalCode}`
    );
  }

  return { pic, plant, renamedFrom };
}

export async function upsertZone(
  env: Env,
  code: string,
  name: string | null
): Promise<Zone> {
  const { gallery, zonesSha } = await readGallery(env);
  const idx = gallery.zones.findIndex((z) => z.code === code);
  let zone: Zone;
  let action: string;
  if (idx === -1) {
    zone = { code, name };
    gallery.zones.push(zone);
    action = "Add";
  } else {
    zone = { ...gallery.zones[idx], name };
    gallery.zones[idx] = zone;
    action = "Rename";
  }
  await writeJsonFile(
    env,
    ZONES_PATH,
    { zones: gallery.zones },
    zonesSha,
    `${action} zone: ${code}`
  );
  return zone;
}

export async function appendZonePic(
  env: Env,
  newZonePic: ZonePicEntry,
  zoneUpsert: Zone | null
): Promise<void> {
  const { gallery, zonesSha, zonePicsSha } = await readGallery(env);

  if (zoneUpsert) {
    const nextZones = applyZoneUpserts(gallery.zones, [zoneUpsert]);
    await writeJsonFile(
      env,
      ZONES_PATH,
      { zones: nextZones },
      zonesSha,
      `Add zone: ${zoneUpsert.code}`
    );
  }

  const nextZonePics = [newZonePic, ...gallery.zonePics];
  await writeJsonFile(
    env,
    ZONE_PICS_PATH,
    { zonePics: nextZonePics },
    zonePicsSha,
    `Add zone pic: ${newZonePic.zoneCode}`
  );
}

export async function deleteZonePic(
  env: Env,
  id: string
): Promise<ZonePicEntry | null> {
  const { gallery, zonePicsSha } = await readGallery(env);
  const idx = gallery.zonePics.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const [removed] = gallery.zonePics.splice(idx, 1);

  await writeJsonFile(
    env,
    ZONE_PICS_PATH,
    { zonePics: gallery.zonePics },
    zonePicsSha,
    `Remove zone pic: ${removed.zoneCode} (${removed.id})`
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
      `Delete zone image: ${removed.zoneCode} (${removed.id})`
    );
  }

  return removed;
}

export interface DeleteZoneResult {
  zone: Zone | null;
  inUseBy: string[];
}

export async function deleteZone(env: Env, code: string): Promise<DeleteZoneResult> {
  const { gallery, zonesSha } = await readGallery(env);
  const idx = gallery.zones.findIndex((z) => z.code === code);
  if (idx === -1) return { zone: null, inUseBy: [] };

  const inUseBy = gallery.pics
    .filter((p) => p.zoneCode === code)
    .map((p) => p.shortCode);
  const zonePicsInUse = gallery.zonePics.filter((p) => p.zoneCode === code);
  if (zonePicsInUse.length > 0) {
    inUseBy.push(`${zonePicsInUse.length} zone pic(s)`);
  }
  if (inUseBy.length > 0) {
    return { zone: gallery.zones[idx], inUseBy };
  }

  const [removed] = gallery.zones.splice(idx, 1);
  await writeJsonFile(
    env,
    ZONES_PATH,
    { zones: gallery.zones },
    zonesSha,
    `Remove zone: ${code}`
  );
  return { zone: removed, inUseBy: [] };
}

export async function upsertAnnotation(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  field: "tags" | "description",
  value: string
): Promise<AnnotationEntry> {
  const { data, sha } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] }
  );
  const annotations = data.annotations ?? [];

  const idx = annotations.findIndex(
    (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
  );

  let entry: AnnotationEntry;
  if (idx === -1) {
    entry = { shortCode, zoneCode, tags: [], description: null };
    annotations.push(entry);
  } else {
    entry = annotations[idx];
  }

  if (field === "tags") {
    entry.tags = parseList(value);
  } else {
    entry.description = value.trim() || null;
  }

  if (idx !== -1) annotations[idx] = entry;

  // Drop entries that carry no information.
  const cleaned = annotations.filter(
    (a) => a.tags.length > 0 || a.description !== null
  );

  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await writeJsonFile(
    env,
    ANNOTATIONS_PATH,
    { annotations: cleaned },
    sha,
    `Annotate ${scope}: ${field}`
  );

  return entry;
}

export async function addPicTag(
  env: Env,
  seq: number,
  tag: string
): Promise<PicEntry | null> {
  const { gallery, picsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;
  if (pic.tags.includes(tag)) return pic;
  pic.tags = [...pic.tags, tag];
  await writeJsonFile(env, PICS_PATH, { pics: gallery.pics }, picsSha, `Add tag to pic #${seq}: ${tag}`);
  return pic;
}

export async function addAnnotationTag(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  tag: string
): Promise<{ entry: AnnotationEntry; added: boolean }> {
  const { data, sha } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] }
  );
  const annotations = data.annotations ?? [];

  const idx = annotations.findIndex(
    (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
  );

  let entry: AnnotationEntry;
  if (idx === -1) {
    entry = { shortCode, zoneCode, tags: [tag], description: null };
    annotations.push(entry);
  } else {
    entry = annotations[idx];
    if (entry.tags.includes(tag)) return { entry, added: false };
    entry = { ...entry, tags: [...entry.tags, tag] };
    annotations[idx] = entry;
  }

  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await writeJsonFile(env, ANNOTATIONS_PATH, { annotations }, sha, `Add tag to ${scope}: ${tag}`);
  return { entry, added: true };
}

export async function removePicTag(
  env: Env,
  seq: number,
  tag: string
): Promise<{ pic: PicEntry; removed: boolean } | null> {
  const { gallery, picsSha } = await readGallery(env);
  const pic = gallery.pics.find((p) => p.seq === seq);
  if (!pic) return null;
  if (!pic.tags.includes(tag)) return { pic, removed: false };
  pic.tags = pic.tags.filter((t) => t !== tag);
  await writeJsonFile(env, PICS_PATH, { pics: gallery.pics }, picsSha, `Remove tag from pic #${seq}: ${tag}`);
  return { pic, removed: true };
}

export async function removeAnnotationTag(
  env: Env,
  shortCode: string,
  zoneCode: string | null,
  tag: string
): Promise<{ entry: AnnotationEntry | null; removed: boolean }> {
  const { data, sha } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] }
  );
  const annotations = data.annotations ?? [];

  const idx = annotations.findIndex(
    (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
  );
  if (idx === -1) return { entry: null, removed: false };

  const existing = annotations[idx];
  if (!existing.tags.includes(tag)) return { entry: existing, removed: false };

  const updated: AnnotationEntry = { ...existing, tags: existing.tags.filter((t) => t !== tag) };
  annotations[idx] = updated;

  // Drop entries that carry no information.
  const cleaned = annotations.filter(
    (a) => a.tags.length > 0 || a.description !== null
  );

  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await writeJsonFile(env, ANNOTATIONS_PATH, { annotations: cleaned }, sha, `Remove tag from ${scope}: ${tag}`);
  return { entry: updated, removed: true };
}

export async function deleteAnnotation(
  env: Env,
  shortCode: string,
  zoneCode: string | null
): Promise<boolean> {
  const { data, sha } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] }
  );
  const annotations = data.annotations ?? [];
  const idx = annotations.findIndex(
    (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
  );
  if (idx === -1) return false;

  annotations.splice(idx, 1);
  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await writeJsonFile(
    env,
    ANNOTATIONS_PATH,
    { annotations },
    sha,
    `Delete annotation: ${scope}`
  );
  return true;
}

export async function readAnnotations(env: Env): Promise<AnnotationEntry[]> {
  const { data } = await readJsonFile<{ annotations?: AnnotationEntry[] }>(
    env,
    ANNOTATIONS_PATH,
    { annotations: [] }
  );
  return data.annotations ?? [];
}

// --- Batch helpers ---------------------------------------------------------
// loadBatchState reads gallery + annotations in a single Promise.all (5 GETs).
// Mutators in batch.ts apply changes to BatchState in memory and mark which
// JSON files got dirty. commitBatchState then writes only the dirty ones,
// turning O(N commands) GitHub round-trips into O(1) regardless of chunk size.

export type DirtyFile =
  | "pics"
  | "plants"
  | "zones"
  | "zonePics"
  | "annotations"
  | "relationships";

export interface BatchState {
  gallery: Gallery;
  annotations: AnnotationEntry[];
  relationships: RelationshipsFile;
  picsSha: string | null;
  plantsSha: string | null;
  zonesSha: string | null;
  zonePicsSha: string | null;
  annotationsSha: string | null;
  relationshipsSha: string | null;
  dirty: Set<DirtyFile>;
  // Image files queued for deletion after JSON commits succeed (per /delete and
  // /deletezonepic). Each costs 2 subrequests: GET sha + DELETE.
  imagesToDelete: Array<{ path: string; message: string }>;
}

export async function loadBatchState(env: Env): Promise<BatchState> {
  const [pics, plants, zones, zonePics, ann, rels] = await Promise.all([
    readJsonFile<{ pics?: PicEntry[] }>(env, PICS_PATH, { pics: [] }),
    readJsonFile<{ plants?: PlantRecord[] }>(env, PLANTS_PATH, { plants: [] }),
    readJsonFile<{ zones?: Zone[] }>(env, ZONES_PATH, { zones: [] }),
    readJsonFile<{ zonePics?: ZonePicEntry[] }>(env, ZONE_PICS_PATH, { zonePics: [] }),
    readJsonFile<{ annotations?: AnnotationEntry[] }>(env, ANNOTATIONS_PATH, { annotations: [] }),
    readJsonFile<Partial<RelationshipsFile>>(env, RELATIONSHIPS_PATH, { types: [], relationships: [] }),
  ]);
  return {
    gallery: {
      pics: pics.data.pics ?? [],
      plants: plants.data.plants ?? [],
      zones: zones.data.zones ?? [],
      zonePics: zonePics.data.zonePics ?? [],
    },
    annotations: ann.data.annotations ?? [],
    relationships: {
      types: rels.data.types ?? [],
      relationships: rels.data.relationships ?? [],
    },
    picsSha: pics.sha,
    plantsSha: plants.sha,
    zonesSha: zones.sha,
    zonePicsSha: zonePics.sha,
    annotationsSha: ann.sha,
    relationshipsSha: rels.sha,
    dirty: new Set(),
    imagesToDelete: [],
  };
}

export async function commitBatchState(
  env: Env,
  state: BatchState,
  message: string
): Promise<{ jsonWrites: number; imagesDeleted: number }> {
  const writes: Array<Promise<void>> = [];
  if (state.dirty.has("zones")) {
    writes.push(writeJsonFile(env, ZONES_PATH, { zones: state.gallery.zones }, state.zonesSha, message));
  }
  if (state.dirty.has("plants")) {
    writes.push(writeJsonFile(env, PLANTS_PATH, { plants: state.gallery.plants }, state.plantsSha, message));
  }
  if (state.dirty.has("pics")) {
    writes.push(writeJsonFile(env, PICS_PATH, { pics: state.gallery.pics }, state.picsSha, message));
  }
  if (state.dirty.has("zonePics")) {
    writes.push(writeJsonFile(env, ZONE_PICS_PATH, { zonePics: state.gallery.zonePics }, state.zonePicsSha, message));
  }
  if (state.dirty.has("annotations")) {
    const cleaned = state.annotations.filter((a) => a.tags.length > 0 || a.description !== null);
    writes.push(writeJsonFile(env, ANNOTATIONS_PATH, { annotations: cleaned }, state.annotationsSha, message));
  }
  if (state.dirty.has("relationships")) {
    writes.push(writeJsonFile(env, RELATIONSHIPS_PATH, state.relationships, state.relationshipsSha, message));
  }
  await Promise.all(writes);

  let imagesDeleted = 0;
  for (const img of state.imagesToDelete) {
    const [owner, repo] = env.GITHUB_REPO.split("/");
    const fileUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${img.path}`;
    try {
      const fileResp = await fetch(fileUrl, { headers: githubHeaders(env.GITHUB_TOKEN) });
      if (fileResp.ok) {
        const fileData: GitHubContentsResponse = await fileResp.json();
        await deleteFile(env, img.path, fileData.sha, img.message);
        imagesDeleted++;
      }
    } catch {
      // Swallow per-image failures; the JSON manifest is the source of truth.
    }
  }
  return { jsonWrites: writes.length, imagesDeleted };
}

export async function readAiAnalyses(
  env: Env
): Promise<{ analyses: AiAnalysisEntry[]; sha: string | null }> {
  const { data, sha } = await readJsonFile<{ analyses?: AiAnalysisEntry[] }>(
    env,
    AI_ANALYSIS_PATH,
    { analyses: [] }
  );
  return { analyses: data.analyses ?? [], sha };
}

export async function writeAiAnalyses(
  env: Env,
  analyses: AiAnalysisEntry[],
  sha: string | null,
  commitMessage: string
): Promise<void> {
  await writeJsonFile(env, AI_ANALYSIS_PATH, { analyses }, sha, commitMessage);
}
