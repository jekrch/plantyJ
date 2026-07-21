import { handlePublicProxy, type PublicEnv } from "./public";

/**
 * Entry for the `plantyj-public` worker — a standalone deployment (see
 * wrangler.public.toml) that serves *only* the anonymous public-garden read
 * proxy. It shares no code, bindings, or secrets with the Telegram bot worker,
 * so its public URL can't be used to reach the bot and a fault here can't affect
 * it. Its one secret is GOOGLE_API_KEY.
 */
export default {
  async fetch(
    request: Request,
    env: PublicEnv,
    ctx: { waitUntil: (p: Promise<unknown>) => void },
  ): Promise<Response> {
    const proxied = await handlePublicProxy(request, env, ctx);
    return proxied ?? new Response("Not found", { status: 404 });
  },
};
