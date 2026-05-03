# PlantyJ Bot — Cloudflare Worker

Telegram webhook handler that receives plant photos, answers garden questions via Gemini, and commits images + plant entries to the GitHub repo.

## How it works

```
Phone (Telegram) → Cloudflare Worker → GitHub Contents API → GitHub Pages
                                     ↘ Gemini API  (/ask)
```

When a photo with a structured caption arrives, the Worker:

1. Verifies the request originated from Telegram and from the allowed chat
2. Parses the caption into `{shortCode, fullName?, commonName?, zoneCode?, zoneName?, tags?, description?}`
3. Resolves missing fields by inheriting from the most recent prior entry with the same `shortCode` (or zone-defining entry for the same `zoneCode`)
4. Downloads the photo via the Telegram Bot API
5. Commits the image to `public/images/{shortCode}/` via the GitHub Contents API
6. Appends an entry to `public/data/pics.json` with metadata + contributor info
7. Replies with a confirmation including the entry's numeric `seq` ID

## Caption format

```
shortCode // fullName // commonName // Zone Name (zoneCode) // tags // description
```

Only `shortCode` is required. Use `Display Name (code)` to declare a new zone; bare `code` to reuse an existing zone. Empty segments are inherited from the previous chronological entry with the matching `shortCode`.

Prefix with `animal //` for non-plant entries.

## Text commands

### Q&A

- `/ask {question}` — ask anything about the garden journal (alias for `/ask2`)
- `/ask1 {question}` — uses `gemini-3.1-flash-lite-preview` (fastest, cheapest)
- `/ask2 {question}` — uses `gemini-2.5-pro` (default)
- `/ask3 {question}` — uses `gemini-3.1-pro-preview` (most capable)

The bot answers factually from the pre-computed plant rollup (`public/data/rollup.min.json`) and can suggest copy-pasteable bot commands to fill data gaps. It never executes writes itself. Each reply includes an approximate token count and cost.

### Data management

- `/delete {seq}` — removes an entry and its image
- `/update {seq} {field} {value}` — updates one field on a pic entry (`shortCode`, `fullName`, `commonName`, `zoneCode`, `tags`, `description`)
- `/accept {seq} [shortCode]` — accepts a BioCLIP species suggestion (optionally overriding the short code)
- `/addtag {seq} {tag}` — adds a tag to a specific pic
- `/addtag {shortCode} // {tag}` — adds a plant-level annotation tag
- `/addtag {shortCode} // {zoneCode} // {tag}` — adds a zone-scoped annotation tag
- `/annotate {shortCode} // {tags} // {value}` — sets a plant-level annotation
- `/annotate {shortCode} // {zoneCode} // {tags} // {value}` — sets a zone-scoped annotation
- `/deleteannotation {shortCode} [// {zoneCode}]` — removes an annotation

### Zones

- `/addzone {code} {name}` — registers a new zone
- `/renamezone {code} {newName}` — renames a zone
- `/deletezone {code}` — removes a zone
- `/deletezonepic {code}` — removes the zone's cover photo

### Info

- `/plants` — list all known plant short codes
- `/zones` — list all zones
- `/tags` — list all tags in use
- `/help` — full usage reference

## AI integration

The `/ask` handler lives in `worker/src/ask.ts`. It:

1. Fetches `rollup.min.json` — a pre-computed, plant-centric denormalization of the four source JSONs (~12–15KB, ~3.5K tokens)
2. Optionally reuses a **Gemini context cache** (server-side, 1-hour TTL) keyed by a SHA-256 checksum of the rollup. Cache state (checksum + Gemini cache name) is persisted in a Workers KV namespace (`ASK_CACHE`). The cache is invalidated automatically when the rollup changes.
3. Runs a tool-call loop (max 3 iterations) with one tool — `get_species(fullName)` — for on-demand taxonomy/Wikipedia lookups
4. Appends an approximate cost line to every reply

## Deployment

The Worker deploys via GitHub Actions on pushes to `main` that touch `worker/`. Cloudflare credentials and Telegram/GitHub secrets live in GitHub repo secrets and Cloudflare Worker secrets — nothing sensitive in the codebase.

## Environment

### `wrangler.toml` vars

| Variable | Description |
|---|---|
| `TELEGRAM_ALLOWED_CHAT_ID` | Telegram chat ID the bot accepts messages from |
| `GITHUB_REPO` | `owner/repo` for GitHub Contents API writes |
| `DATA_BASE_URL` | Base URL for reading JSON data files (default: `https://plantyj.com/data`) |
| `LLM_MODEL` | Default Gemini model (overridden per-command by `/ask1`–`/ask3`) |

### Secrets (`wrangler secret put`)

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `GITHUB_TOKEN` | GitHub PAT with `contents:write` on the repo |
| `GEMINI_API_KEY` | Google AI API key |
| `WEBHOOK_SECRET` | Optional — Telegram webhook secret token |

### KV namespaces

| Binding | Purpose |
|---|---|
| `ASK_CACHE` | Persists Gemini context-cache state between Worker invocations. Optional — caching is skipped if absent. |

To create:
```bash
bunx wrangler kv namespace create ASK_CACHE          # production
bunx wrangler kv namespace create ASK_CACHE --preview # local dev
```

Then add the printed IDs to the `[[kv_namespaces]]` block in `wrangler.toml`.
