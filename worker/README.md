# PlantyJ Bot — Cloudflare Worker

Telegram webhook handler that receives plant photos, parses captions, and commits images + plant entries to the GitHub repo.

## How it works

```
Phone (Telegram) → Cloudflare Worker → GitHub Contents API → GitHub Pages
```

When a photo with a structured caption arrives, the Worker:

1. Verifies the request originated from Telegram and from the allowed chat
2. Parses the caption into `{shortCode, fullName?, commonName?, zoneCode?, zoneName?, tags?, description?}`
3. Resolves missing fields by inheriting from the most recent prior entry with the same `shortCode` (or zone-defining entry for the same `zoneCode`)
4. Downloads the photo via the Telegram Bot API
5. Commits the image to `public/images/{shortCode}/` via the GitHub Contents API
6. Appends an entry to `public/data/plants.json` with metadata + contributor info
7. Replies with a confirmation including the entry's numeric `seq` ID

Text commands:

- `/delete {seq}` — removes an entry and its image
- `/update {seq} {field} {value}` — updates one field (`shortCode`, `fullName`, `commonName`, `zoneCode`, `zoneName`, `tags`, `description`)
- `/help` — usage + a dynamically-built directory of every known plant `shortCode` and `zoneCode`

## Caption format

```
shortCode // fullName // commonName // Zone Name (zoneCode) // tags // description
```

Only `shortCode` is required. Use `Display Name (code)` to declare a new zone; bare `code` to reuse an existing zone. Empty segments are inherited from the previous chronological entry with the matching `shortCode`.

## Deployment

The Worker deploys via GitHub Actions on pushes to `main` that touch `worker/`. Cloudflare credentials and Telegram/GitHub secrets live in GitHub repo secrets and Cloudflare Worker secrets — nothing sensitive in the codebase.
