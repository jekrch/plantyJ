import type {
  Env,
  Gallery,
  GitHubContentsResponse,
  PicEntry,
  PlantRecord,
  Zone,
  ZonePicEntry,
} from "./types";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "plantyj-bot";
const PICS_PATH = "public/data/pics.json";
const PLANTS_PATH = "public/data/plants.json";
const ZONES_PATH = "public/data/zones.json";
const ZONE_PICS_PATH = "public/data/zone_pics.json";

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
  const content = atob(meta.content.replace(/\n/g, ""));
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

  const updatedContent = btoa(JSON.stringify(body, null, 2));

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
      `Add/update plant: ${plantUpsert.shortCode}`
    );
  }

  const nextPics = [newPic, ...gallery.pics];
  await writeJsonFile(
    env,
    PICS_PATH,
    { pics: nextPics },
    picsSha,
    `Add pic: ${newPic.shortCode}`
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
const PLANT_FIELDS = ["shortCode", "fullName", "commonName"] as const;
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
