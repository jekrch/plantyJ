export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  WEBHOOK_SECRET?: string;
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

export interface ParsedCaption {
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  tags: string[] | null;
  description: string | null;
}

export interface PlantEntry {
  seq: number;
  id: string;
  shortCode: string;
  fullName: string | null;
  commonName: string | null;
  zoneCode: string;
  zoneName: string | null;
  tags: string[];
  description: string | null;
  image: string;
  postedBy: string;
  addedAt: string;
}

export interface Gallery {
  plants: PlantEntry[];
}
