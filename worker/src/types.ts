export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  WEBHOOK_SECRET?: string;
  DATA_BASE_URL?: string;
  LLM_MODEL?: string;
  GEMINI_API_KEY: string;
  // KV namespace for persisting Gemini context-cache state between requests.
  // Optional — caching is skipped gracefully when absent.
  ASK_CACHE?: KVNamespace;
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
  fullName: string | null;
  commonName: string | null;
  variety: string | null;
  zone: ParsedZoneRef | null;
  tags: ParsedTags | null;
  description: string | null;
  kind: "plant" | "animal";
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
}

export interface Gallery {
  pics: PicEntry[];
  plants: PlantRecord[];
  zones: Zone[];
  zonePics: ZonePicEntry[];
}
