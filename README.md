# PlantyJ :seedling:
[![Deploy frontend to GitHub Pages](https://github.com/jekrch/plantyJ/actions/workflows/deploy-frontend.yml/badge.svg)](https://github.com/jekrch/plantyJ/actions/workflows/deploy-frontend.yml)


An agentic garden journal. The whole thing is driven from a Telegram bot: snap a plant with a caption and it lands on the site; ask the bot a question about the collection and it answers from a live rollup of every plant, zone, and photo; describe a change in plain English and it drafts the bot commands to make it, waiting on your `/confirm` before anything writes.

[plantyj.com](https://plantyj.com)

## How it works
```
Telegram group → Cloudflare Worker → GitHub repo → GitHub Pages
```

Photos sent to the Telegram bot get parsed, committed to this repo, and served as a static gallery. The site rebuilds automatically on each new entry; metadata + BioCLIP embeddings refresh whenever `plants.json` changes.

## Caption format

Primary (`//` delimited). Only `shortCode` is required:
```text
shortCode // fullName // commonName // Zone Name (zoneCode) // tags // description
```

First time registering a plant + zone:
```text
tmt-c // Solanum lycopersicum 'Cherokee Purple' // Cherokee Purple Tomato // Front Bed 1 (fb1) // edible,heirloom // first ripe fruit
```

Once the plant and zone are known, fields can be left blank to inherit from the most recent prior entry:
```text
tmt-c // // // fb1 // // sizing up nicely
```

If the plant hasn't moved zones, the bare code is enough:
```text
tmt-c
```

To declare a new zone, wrap the code in parentheses after the display name: `Front Bed 1 (fb1)`. To reuse an existing zone, just write the code: `fb1`.

## Telegram commands

Each entry is assigned a numeric `seq` ID on creation. The bot responds to:

- `/delete {seq}`: remove an entry and its image
- `/update {seq} {field} {value}`: edit a field (`shortCode`, `fullName`, `commonName`, `zoneCode`, `zoneName`, `tags`, `description`)
- `/help`: usage instructions plus a directory of every known plant `shortCode` and `zoneCode`

### Q&A (Gemini)

Ask anything about the journal in plain English:

```
/ask which plants are native to MN but missing the mn tag?
/ask what zones don't have a zone pic yet?
/ask I want to post a robin photo to the maple zone — what's the caption?
```

Follow up on the previous answer without re-asking from scratch:

```
/resp what about animals?
/resp actually, just list the zone codes
```

`/resp` continues the last `/ask` thread. A new `/ask` always starts a fresh thread. Both commands accept a model suffix to switch models for that turn (e.g. `/resp1` for a quick follow-up, `/resp3` to go deeper).

The bot answers from a pre-computed plant rollup and can suggest ready-to-send commands for data gaps. It never executes writes itself. Three model tiers are available:

| Command | Model |  |
|---|---|---|
| `/ask1` / `/resp1` | `gemini-3.1-flash-lite-preview` | |
| `/ask2` / `/resp2` | `gemini-2.5-pro` | |
| `/ask` / `/ask3` / `/resp3` | `gemini-3.1-pro-preview` | Default |

Each reply includes an approximate token count and cost.

### Action agent (`/do`, `/confirm`)

Describe a change in plain English. The bot reads the current plant/zone/photo rollup, may look up species records to disambiguate, and proposes a numbered list of bot commands — then waits.

```
/do tag every tomato as edible
/do delete the orphan pics in the maple zone
/do fix the commonName for tmt-c, it's missing
```

The agent only proposes existing verbs (`/addtag`, `/removetag`, `/update`, `/delete`, `/addzone`, `/renamezone`, etc.) and never executes anything itself.

- `/confirm` — run every proposal
- `/confirm 1 3` — run only the listed proposals (space- or comma-separated)
- `/cancel` — drop the pending list

Pending proposals expire after an hour. Confirmed commands are queued and run in chunks (~25/min) to stay inside Cloudflare and GitHub API limits; a summary is posted when the batch finishes.

## Image metadata

A GitHub Action (`compute-metadata.yml`) runs whenever `plants.json` changes. It backfills missing per-image metadata:

- `width` / `height`: pixel dimensions for layout placeholders
- `phash`: DCT-based perceptual hash (used by the **duplicates** sort to surface near-identical photos)
- `dominantColors`: three most prominent CIELAB colors via k-means

## Species enrichment

For each unique `fullName`, an entry keyed by slug is added to `public/data/species.json` and progressively enriched from three sources, all best-effort:

- **GBIF Species API**: canonical taxonomy (kingdom → species) and English vernacular names
- **POWO (Kew)**: fallback for native range when GBIF isn't enough
- **Wikipedia**: lead section as `description`, keyed on the base species name (cultivar suffix stripped)

Each source is gated on a `sources` list per species entry, so re-runs only hit each API once. 404s and rate limits are caught — a third-party hiccup never fails the build.

## Embeddings & Classification: BioCLIP

[`imageomics/bioclip`](https://huggingface.co/imageomics/bioclip) is a vision model fine-tuned on the Tree of Life dataset. It groups species, families, and visual plant forms far better than generic vision models. 

For every new image, the GitHub Action computes two things:
1. **Embeddings:** A 512-dim unit-normalized vector saved to `public/data/embeddings.json` (used for similarity sorting).
2. **Species Prediction:** Uses the `pybioclip` Tree of Life classifier to inject the most confident species identification (`bioclipSpeciesId`, `bioclipCommonName`, and `bioclipScore`) directly into the image record in `pics.json`.

*Note: HuggingFace weights and the taxonomic classifier assets are cached via GitHub Actions to speed up incremental runs.*

## Ecological fit analysis

For every specimen + zone pair (plant or animal), the bot can produce a 1–2 paragraph ecological-niche write-up grounded against Google Search. Each entry gets a `GOOD` / `BAD` / `MIXED` verdict and a list of source URLs filtered against the model's actually-grounded results, so cited links can't be hallucinated. Results are committed to `ai_analysis.json`.

Submission goes through Gemini's Batch API to keep cost low, so the workflow is two steps:

- `/analyze` — submit a batch covering every pair that doesn't have an analysis yet
- `/analyze {zoneCode}` — same, scoped to one zone (the full property rollup still informs reasoning)
- `/analyze-load` — poll the pending job; when it's finished, parse, validate references, and commit
- `/analyze-attach {jobName}` — reattach to an existing Gemini batch if the KV pointer was lost

Verdicts and analyses surface in two places on the site:

- **Plant info drawer:** an "Ecological Fit Analysis" section with a colored verdict meter, the prose analysis, and grounded source pills for the current photo's plant in its current zone.
- **Tree node detail:** species nodes in the Tree View show the same analysis. When a species has been recorded in multiple zones, a per-zone switcher lets you compare verdicts across locations.

The Filters bar also exposes a `Verdict` multi-select to narrow the gallery to GOOD / BAD / MIXED entries.

## Tree View

An interactive phylogenetic tree of all plants in the collection, built from their GBIF taxonomy. Ranks (Kingdom → Species) appear as column headers with edges connecting parent to child nodes. Leaf nodes show a circular plant thumbnail and common name.

- Pan and zoom via mouse wheel or pointer drag
- Search by species name, common name, or taxon
- Click any node to see a detail panel with linked photos and a jump to the gallery filtered by that taxon
- Clicking a taxon rank in the plant info drawer opens the tree focused on that node

## Plant & Zone Views

The overhead switcher exposes four primary sections: **Gallery**, **Plant**, **Zone**, and **Tree**. Plant and Zone are spotlight sections — each focuses on a single subject selected from a dropdown (with prev/next stepping). Clicking a plant short code or zone name anywhere in the app also jumps directly to the relevant spotlight.

- **Plant view:** Hero image of the plant with a thumbnail strip of every other photo of that species. Clicking opens the full info drawer.
- **Zone view:** Hero image for the zone followed by every plant and zone photo recorded there, sorted newest-first. Thumbnails are labeled with the plant name or zone name.

## Plant Viewer Info

When viewing a specific photo in the gallery, opening the info drawer surfaces a dense layer of aggregated context about the plant, its location, and its taxonomy:

- **Identity & Notes:** The primary names (`commonName`, `fullName`, `shortCode`), user-provided descriptions, and attached tags.
- **Photo Timeline:** A scrollable chronological history of all other photos of that specific plant.
- **Zone Context:** The physical location (`zoneName`) and a visual list of other distinct plants currently sharing that zone.
- **Species Overview:** A description pulled from Wikipedia.
- **Vernacular Names:** Alternative common names pulled from the GBIF API.
- **Taxonomic Lineage:** The full hierarchical classification (Kingdom down to Species). Each rank is interactive — click to filter the gallery by that taxon or jump to it in the Tree View.
- **Native Range:** Geographic origin data pulled from POWO.
- **BioCLIP Prediction:** The AI-generated species identification and confidence score, including a logic check that flags whether the visual prediction matches, shares a genus with, or contradicts the manually recorded species.
- **External Sources:** Direct links to source records — GBIF, POWO, Wikipedia, iNaturalist, Wikidata, and NatureServe (conservation status).

## Info Modal Stats

The info modal (accessible via the site header) has four tabs: **About**, **Stats**, **Plants**, and **Zones**. The Stats tab surfaces a collection-wide snapshot:

- **Hero banner:** Total days the journal has been running, counted from the first entry.
- **Tile row:** Total photos, unique plant species, unique animal species, and zones with photos.
- **Biodiversity:** A donut chart of photos grouped by taxonomic rank (Kingdom → Genus). The rank is selectable; clicking any slice filters the gallery by that taxon.
- **Activity:** A bar chart of photos over time, with granularity (day / week / month) adapting automatically to the span of the collection.
- **Zones:** Highlight cards for the most-photographed and most species-diverse zones. Clicking either opens the zone spotlight.
- **Machine ID:** BioCLIP summary — average confidence across all scored photos, number of species disagreements (clickable to filter the gallery to those entries), and count of unidentified photos.

## Sort modes

- **Newest / Oldest**: chronological by date added
- **Color**: hue-angle walk through the dominant CIELAB color of each photo
- **Similarity (BioCLIP)**: nearest-neighbor chain by cosine distance on BioCLIP embeddings; clusters by species and visual form

## Filters

- `Plant`: multi-select on `shortCode` (display labels are `commonName`s)
- `Zone`: multi-select on `zoneCode` (display labels are `zoneName`s)
- `Tags`: multi-select free-text tags
- `Posted by`: multi-select Telegram user

## Development

```bash
bun install
bun run dev
```

The worker has its own setup — see [worker/README.md](worker/README.md).

## Stack

- **Frontend:** React, TypeScript, Tailwind, Vite, Bun
- **Backend:** Cloudflare Worker
- **Scripting:** Python (PyTorch, OpenCLIP, scikit-image, pybioclip)
- **Hosting:** GitHub Pages
- **Storage:** Git (images + JSON committed via the GitHub Contents API)
