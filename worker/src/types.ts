/** The slice of Workers KV that usernames.ts and the public proxy use. Kept
 *  narrow so tests can pass a plain in-memory object. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Bot worker env. Vars and bindings (ASK_CACHE, JOBS, ...) come from the
 * `wrangler types` output for wrangler.toml (worker-configuration.d.ts,
 * regenerated on `bun install`); only secrets are declared here, since
 * `wrangler secret put` values don't appear in that output.
 */
export interface Env extends Cloudflare.Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  photo?: TelegramPhotoSize[];
  caption?: string;
  text?: string;
  media_group_id?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path: string };
}

export interface GitHubContentsResponse {
  content: string;
  sha: string;
  /** "none" (with empty content) for files over 1 MB. */
  encoding?: string;
}

export interface ParsedZoneRef {
  code: string;
  name: string | null;
}

export interface ParsedTags {
  picTags: string[];
  zoneTags: string[];
  plantTags: string[];
}

export interface ParsedCaption {
  shortCode: string;
  /** True when the caption omitted the shortCode (empty leading segment) and
   *  one must be generated from the species name. `shortCode` is "" then. */
  autoCode: boolean;
  fullName: string | null;
  commonName: string | null;
  variety: string | null;
  zone: ParsedZoneRef | null;
  tags: ParsedTags | null;
  description: string | null;
}

export interface PicEntry {
  seq: number;
  id: string;
  shortCode: string;
  zoneCode: string;
  tags: string[];
  description: string | null;
  image: string;
  postedBy: string;
  addedAt: string;
  width?: number;
  height?: number;
  bioclipSpeciesId?: string | null;
  bioclipCommonName?: string | null;
  bioclipScore?: number | null;
  kind?: "plant" | "animal";
}

export interface PlantRecord {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  variety?: string | null;
}

export interface Zone {
  code: string;
  name: string | null;
  description?: string | null;
}

export interface ZonePicEntry {
  id: string;
  zoneCode: string;
  image: string;
  addedAt: string;
  postedBy: string;
  description: string | null;
}

export interface AnnotationEntry {
  shortCode: string;
  zoneCode: string | null;
  tags: string[];
  description: string | null;
  /** When true, this plant+zone combo has been removed from the garden. The
   *  pic still shows in the gallery (flagged) but is filtered out of the food
   *  web, tree, and zone/plant views. Only meaningful when zoneCode is set. */
  removed?: boolean;
}

export type AiVerdict = "GOOD" | "BAD" | "MIXED";

export interface AiAnalysisEntry {
  shortCode: string;
  zoneCode: string;
  verdict: AiVerdict;
  analysis: string;
  references: string[];
  created: string;
  /** Internal-only: a concise summary of user-provided observations from
   *  /reassess. Weighed into regenerations; never rendered on the public site
   *  (the frontend AIAnalysis type intentionally omits it). */
  note?: string;
}

export interface Gallery {
  pics: PicEntry[];
  plants: PlantRecord[];
  zones: Zone[];
  zonePics: ZonePicEntry[];
}

export type RelationshipDirection = "f" | "b" | "u";

export interface RelationshipType {
  id: string;
  name: string;
  description: string;
  directional: boolean;
}

export interface Relationship {
  id: number;
  type: string;
  from: string;
  to: string;
  direction?: RelationshipDirection;
}

export interface RelationshipsFile {
  types: RelationshipType[];
  relationships: Relationship[];
}
