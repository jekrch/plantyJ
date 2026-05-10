import type { Env, TelegramUpdate } from "./types";
import { makeReplier } from "./telegram";
import { handleTextCommand } from "./commands";
import { handlePhotoMessage } from "./photos";
import { processAnalyzeTick } from "./analyze";
import { processJobsTick } from "./jobs";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil: (p: Promise<unknown>) => void }
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    if (!env.WEBHOOK_SECRET) {
      return new Response("Webhook secret not configured", { status: 500 });
    }
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!secret || !timingSafeEqual(secret, env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 403 });
    }

    const update: TelegramUpdate = await request.json();

    // Ack the webhook immediately so Telegram doesn't time out at ~60s and
    // retry the update mid-LLM-call. handleUpdate runs to completion in the
    // background.
    ctx.waitUntil(
      handleUpdate(update, env).catch((err) => {
        console.log(`handleUpdate failed: ${(err as Error).message}`);
      })
    );
    return new Response("OK");
  },

  async scheduled(
    _event: { cron?: string; scheduledTime?: number },
    env: Env,
    ctx: { waitUntil: (p: Promise<unknown>) => void }
  ): Promise<void> {
    ctx.waitUntil(
      Promise.all([
        processAnalyzeTick(env)
          .then((r) => {
            if (r.ranTick) {
              console.log(
                `[analyze.cron] processed=${r.processed} succeeded=${r.succeeded} failed=${r.failed} remaining=${r.remaining}`
              );
            }
          })
          .catch((err) => {
            console.log(`[analyze.cron] tick failed: ${(err as Error).message}`);
          }),
        processJobsTick(env)
          .then((r) => {
            if (r.ranTick) {
              console.log(
                `[jobs.cron] succeeded=${r.succeeded} failed=${r.failed} remaining=${r.remaining}`
              );
            }
          })
          .catch((err) => {
            console.log(`[jobs.cron] tick failed: ${(err as Error).message}`);
          }),
      ])
    );
  },
};

// Constant-time string comparison so that a wrong webhook secret can't be
// progressively recovered byte-by-byte via response timing. The early-exit on
// length difference leaks length, which is fine: the secret length is fixed
// per deployment.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Fail closed: an unset/empty ALLOWED_USER_IDS used to grant access to anyone
// who could reach the chat. Now an unset list means no one is authorized.
function isAllowedUser(userId: number | undefined, env: Env): boolean {
  if (!env.ALLOWED_USER_IDS) return false;
  if (userId === undefined) return false;
  return env.ALLOWED_USER_IDS.split(",").some((id) => id.trim() === String(userId));
}

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message) return;
  if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) return;
  if (!isAllowedUser(message.from?.id, env)) return;

  const reply = makeReplier(env, message);

  if (message.text) {
    await handleTextCommand(message.text.trim(), message, env, reply);
    return;
  }

  await handlePhotoMessage(message, env, reply);
}
