# PlantyJ Bot — Setup Guide

End-to-end setup for the Cloudflare Worker + Telegram integration that powers `worker/src/index.ts`. Follow top to bottom; each step assumes the previous.

## What you'll end up with

- A Telegram bot that DMs/groups can post photos to
- A Cloudflare Worker that receives those photos via webhook
- Auto-deploys from GitHub Actions on pushes to `main` that touch `worker/`
- Commits images + `plants.json` entries back into this repo via the GitHub Contents API

---

## 1. Create the Telegram bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather).
2. Send `/newbot`. Pick a display name and a unique username ending in `bot`.
3. Save the **bot token** BotFather gives you (looks like `123456789:ABCdef...`). This is your `TELEGRAM_BOT_TOKEN`.
4. Send `/setprivacy` → choose your bot → **Disable**. This lets it read all group messages (needed when used in a group chat).

## 2. Find your allowed chat ID

You only want *your* chat to be able to post. The Worker rejects everything else.

1. Add the bot to the chat (group or DM).
2. Send any message to the chat.
3. In a browser, hit:
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```
4. Find `"chat":{"id": -100123...}` in the JSON. Save that number — it's your `TELEGRAM_ALLOWED_CHAT_ID`.
5. Update [worker/wrangler.toml](worker/wrangler.toml) `TELEGRAM_ALLOWED_CHAT_ID` if it differs from the committed value.

> Group chat IDs are negative; DM chat IDs are positive.

## 3. Create a GitHub fine-grained PAT

The Worker writes images and `plants.json` back into this repo.

1. Go to <https://github.com/settings/personal-access-tokens/new>.
2. **Resource owner**: your account. **Repository access**: only `jekrch/plantyJ`.
3. **Permissions** → Repository permissions → **Contents: Read and write**.
4. Set a long expiration (or no expiration if your org allows).
5. Save the token — this is your `GITHUB_TOKEN`.

## 4. Generate a webhook secret

This is just a random string Telegram echoes back so the Worker can verify the call really came from Telegram.

```bash
openssl rand -hex 32
```

Save the output — this is your `WEBHOOK_SECRET`.

## 5. Cloudflare account setup

1. Sign up / log in at <https://dash.cloudflare.com>.
2. Grab your **Account ID** from the right sidebar of the dashboard home.
3. Create an API token: <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → use the **Edit Cloudflare Workers** template → restrict to your account → create → save the token.

## 6. Install Wrangler & log in locally

```bash
cd worker
bun install
bunx wrangler login
```

This opens a browser to authorize Wrangler. Needed only for setting secrets and the first deploy.

## 7. Set Worker secrets

These live inside Cloudflare, not in the repo. Run from `worker/`:

```bash
bunx wrangler secret put TELEGRAM_BOT_TOKEN
bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put WEBHOOK_SECRET
```

Each command prompts you to paste the value.

> The non-secret vars (`TELEGRAM_ALLOWED_CHAT_ID`, `GITHUB_REPO`) come from `wrangler.toml`.

## 8. First deploy

```bash
bunx wrangler deploy
```

Wrangler prints the deployed URL, e.g.:

```
https://plantyj-bot.<your-subdomain>.workers.dev
```

Save that URL.

## 9. Register the Telegram webhook

Tell Telegram to POST updates to your Worker:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://plantyj-bot.<your-subdomain>.workers.dev",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

You should see your URL and `"pending_update_count": 0`.

## 10. Set up GitHub Actions auto-deploy

[.github/workflows/deploy-worker.yml](.github/workflows/deploy-worker.yml) deploys on every push to `main` that touches `worker/`. It needs two repo secrets:

1. Go to **Repo → Settings → Secrets and variables → Actions → New repository secret**.
2. Add:
   - `CLOUDFLARE_API_TOKEN` — from step 5
   - `CLOUDFLARE_ACCOUNT_ID` — from step 5

Push a trivial change under `worker/` (or trigger the workflow manually via the Actions tab) to confirm CI deploys cleanly.

## 11. Smoke test the bot

In your allowed chat:

1. Send `/help` — bot should reply with command help + the (currently empty) plant/zone directory.
2. Post a photo with caption:
   ```
   tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit
   ```
3. Bot replies with `Added plant #1: tmt-c …`.
4. Check the repo — there should be two new commits: one adding `public/images/tmt-c/<timestamp>.jpg`, one updating `public/data/plants.json`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Worker returns 403 to Telegram | `WEBHOOK_SECRET` mismatch — re-run step 9 with the value you set in step 7 |
| Bot silent in group | Privacy mode still on (step 1.4), or wrong `TELEGRAM_ALLOWED_CHAT_ID` |
| `Error: ... 401` in bot reply | `GITHUB_TOKEN` expired or lacks Contents:write on this repo |
| `Error: ... 404` in bot reply | `GITHUB_REPO` in `wrangler.toml` is wrong |
| Photo posted, no reply | Check `bunx wrangler tail` from `worker/` to see live logs |
| `getWebhookInfo` shows `last_error_message` | Read the message — usually a stale URL or bad TLS |

## Rotating secrets

- Telegram bot token: BotFather → `/revoke` → re-run `wrangler secret put TELEGRAM_BOT_TOKEN` and re-register webhook (step 9).
- GitHub PAT: regenerate at GitHub settings → re-run `wrangler secret put GITHUB_TOKEN`.
- Webhook secret: generate new value → `wrangler secret put WEBHOOK_SECRET` → re-run step 9.
