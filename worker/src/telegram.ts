import type { TelegramFileResponse } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
const TELEGRAM_MAX_MESSAGE = 4096;

/** Download a photo from Telegram by file_id. */
export async function downloadFile(
  fileId: string,
  botToken: string
): Promise<ArrayBuffer> {
  const fileResp = await fetch(
    `${TELEGRAM_API}/bot${botToken}/getFile?file_id=${fileId}`
  );
  const fileData: TelegramFileResponse = await fileResp.json();
  if (!fileData.ok || !fileData.result) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(fileData)}`);
  }

  const downloadResp = await fetch(
    `${TELEGRAM_API}/file/bot${botToken}/${fileData.result.file_path}`
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

/** Send a reply message in a Telegram chat. Splits messages over 4096 chars. */
export async function sendReply(
  botToken: string,
  chatId: number,
  replyToId: number,
  text: string
): Promise<void> {
  const chunks = chunkForTelegram(text);
  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
    if (i === 0) body.reply_to_message_id = replyToId;
    const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.log(`sendReply failed: ${res.status} ${errText}`);
    }
  }
}