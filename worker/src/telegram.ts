import type { TelegramFileResponse } from "./types";

const TELEGRAM_API = "https://api.telegram.org";

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

/** Send a reply message in a Telegram chat. */
export async function sendReply(
  botToken: string,
  chatId: number,
  replyToId: number,
  text: string
): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToId,
    }),
  });
}