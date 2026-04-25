# PlantyJ :seedling:

A private garden journal for two. Snap a plant, send it to a Telegram group with a caption, and it shows up on the site.

## How it works
```
Telegram group → Cloudflare Worker → GitHub repo → GitHub Pages
```

Photos sent to the Telegram bot get parsed, committed to this repo, and served as a static gallery. The site rebuilds automatically on each new entry; metadata + BioCLIP embeddings refresh whenever `plants.json` changes.

## Caption format

Primary (`//` delimited). Only `shortCode` is required:
```
shortCode // fullName // commonName // Zone Name (zoneCode) // tags // description
```

First time registering a plant + zone:
```
tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit
```

Once the plant and zone are known, fields can be left blank to inherit from the most recent prior entry:
```
tmt-c // // // fb1 // // sizing up nicely
```

If the plant hasn't moved zones, the bare code is enough:
```
tmt-c
```

To declare a new zone, wrap the code in parentheses after the display name: `Front Bed 1 (fb1)`. To reuse an existing zone, just write the code: `fb1`.

## Telegram commands

Each entry is assigned a numeric `seq` ID on creation. The bot responds to:

- `/delete {seq}` — remove an entry and its image
- `/update {seq} {field} {value}` — edit a field (`shortCode`, `fullName`, `commonName`, `zoneCode`, `zoneName`, `tags`, `description`)
- `/help` — usage instructions plus a directory of every known plant `shortCode` and `zoneCode`

## Image metadata

A GitHub Action (`compute-metadata.yml`) runs whenever `plants.json` changes. It backfills missing per-image metadata:

- `width` / `height` — pixel dimensions for layout placeholders
- `phash` — DCT-based perceptual hash (used by the **duplicates** sort to surface near-identical photos)
- `dominantColors` — three most prominent CIELAB colors via k-means

## Species enrichment

For each unique `fullName`, a record at `public/data/species/{slug}.json` is created and progressively enriched from three sources, all best-effort:

- **GBIF Species API** — canonical taxonomy (kingdom → species) and English vernacular names
- **POWO (Kew)** — fallback for native range when GBIF isn't enough
- **Wikipedia** — lead section as `description`, keyed on the base species name (cultivar suffix stripped)

Each source is gated on a `sources` list per species file, so re-runs only hit each API once. 404s and rate limits are caught — a third-party hiccup never fails the build.

## Embeddings — BioCLIP

[`imageomics/bioclip`](https://huggingface.co/imageomics/bioclip) is a CLIP variant fine-tuned on the Tree of Life dataset. It groups species, families, and visual plant forms far better than generic vision models like SigLIP or DINOv2.

Output: `public/data/embeddings.json` (one 512-dim unit-normalized vector per plant photo). Incremental — only new images are embedded. HuggingFace and torch weights are cached across runs.

## Sort modes

- **Newest / Oldest** — chronological by date added
- **Color** — hue-angle walk through the dominant CIELAB color of each photo
- **Similarity** — nearest-neighbor chain by cosine distance on BioCLIP embeddings; clusters by species and visual form
- **Duplicates** — Hamming distance on perceptual hashes; useful for spotting near-identical shots of the same plant

## Filters

- `Plant` — multi-select on `shortCode` (display labels are `commonName`s)
- `Zone` — multi-select on `zoneCode` (display labels are `zoneName`s)
- `Tags` — multi-select free-text tags
- `Posted by` — multi-select Telegram user

## Development

```bash
bun install
bun run dev
```

The worker has its own setup — see [worker/README.md](worker/README.md).

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite, Bun
- **Backend:** Cloudflare Worker
- **Scripting:** Python (PyTorch, OpenCLIP, scikit-image)
- **Hosting:** GitHub Pages
- **Storage:** Git (images + JSON committed via the GitHub Contents API)
