import type { Env, TelegramFileResponse, TelegramMessage } from "./types";

/** A pre-bound reply function for a specific chat/message. */
export type Replier = (text: string) => Promise<void>;

/** Bind sendReply to a (chat, replyTo) pair so handlers can call `reply(text)`. */
export function makeReplier(env: Env, message: TelegramMessage): Replier {
  return (text) => sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, text);
}

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_MAX_MESSAGE = 4096;
// On a 429 Telegram says how long to back off (parameters.retry_after, in
// seconds). Wait and retry once when that's short; a longer wait would eat
// the ~30s waitUntil window the webhook path runs in.
const MAX_RETRY_AFTER_SECONDS = 5;

/** Download a photo from Telegram by file_id. */
export async function downloadFile(fileId: string, botToken: string): Promise<ArrayBuffer> {
  const fileResp = await fetch(`${TELEGRAM_API}/bot${botToken}/getFile?file_id=${fileId}`);
  const fileData: TelegramFileResponse = await fileResp.json();
  if (!fileData.ok || !fileData.result) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(fileData)}`);
  }

  const downloadResp = await fetch(
    `${TELEGRAM_API}/file/bot${botToken}/${fileData.result.file_path}`,
  );
  if (!downloadResp.ok) {
    throw new Error(`Image download failed (HTTP ${downloadResp.status})`);
  }
  return downloadResp.arrayBuffer();
}

function chunkForTelegram(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MAX_MESSAGE) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MAX_MESSAGE);
    if (cut < TELEGRAM_MAX_MESSAGE / 2) cut = TELEGRAM_MAX_MESSAGE;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function postSendMessage(botToken: string, body: Record<string, unknown>): Promise<Response> {
  const post = () =>
    fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const res = await post();
  if (res.status !== 429) return res;
  const data = (await res
    .clone()
    .json()
    .catch(() => null)) as { parameters?: { retry_after?: number } } | null;
  const wait = data?.parameters?.retry_after;
  if (wait === undefined || wait > MAX_RETRY_AFTER_SECONDS) return res;
  await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  return post();
}

/** Send a reply message in a Telegram chat. Splits messages over 4096 chars. */
export async function sendReply(
  botToken: string,
  chatId: number,
  replyToId: number,
  text: string,
): Promise<void> {
  const chunks = chunkForTelegram(text);
  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
    // Queued jobs can reply minutes later; if the original message was
    // deleted in the meantime, still send rather than fail.
    if (i === 0) {
      body.reply_parameters = { message_id: replyToId, allow_sending_without_reply: true };
    }
    const res = await postSendMessage(botToken, body);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log(`sendReply failed: ${res.status} ${errText}`);
    }
  }
}
