// Post-build SEO prerender.
//
// The site is a client-rendered SPA, so crawlers and social bots that don't
// run JS see an empty <div id="root">. This script reads the static data
// bundles and injects a semantic, text-only outline of the garden (plants +
// zones, with names and descriptions) into #root. React's createRoot() clears
// these children on mount, so real users still get the live gallery — this
// content exists purely to give crawlers something to index.
//
// Run automatically after `vite build` (see package.json "build").

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distHtml = join(root, "dist", "index.html");
const dataDir = join(root, "public", "data");

const SITE = "https://plantyj.com";
const DESC_CHARS = 200;

function readJson(name) {
  try {
    return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
  } catch {
    return null;
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mirror of useOrganismData.slugifyName so species lookups match the app.
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clip(text, max) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function organismTitle(p) {
  const base = p.commonName || p.fullName || p.shortCode;
  return p.variety ? `${base} '${p.variety}'` : base;
}

const plants = readJson("plants.json")?.plants ?? [];
const zones = readJson("zones.json")?.zones ?? [];
const pics = readJson("pics.json")?.pics ?? [];
const speciesBySlug = readJson("species.json")?.species ?? {};

// Count photos per plant so we can mention the gallery size.
const picCount = new Map();
for (const pic of pics) picCount.set(pic.shortCode, (picCount.get(pic.shortCode) ?? 0) + 1);

const namedPlants = plants
  .filter((p) => !(p.shortCode?.startsWith("unid-") && !p.fullName && !p.commonName))
  .sort((a, b) => organismTitle(a).localeCompare(organismTitle(b)));

const plantItems = namedPlants
  .map((p) => {
    const title = organismTitle(p);
    const sci = p.fullName && p.fullName !== title ? ` <em>(${esc(p.fullName)})</em>` : "";
    const species = p.fullName ? speciesBySlug[slugify(p.fullName)] : null;
    const blurb = species?.description ? ` — ${esc(clip(species.description, DESC_CHARS))}` : "";
    const href = `/?plants=${encodeURIComponent(p.shortCode)}`;
    return `      <li><a href="${esc(href)}"><strong>${esc(title)}</strong></a>${sci}${blurb}</li>`;
  })
  .join("\n");

const zoneItems = zones
  .filter((z) => z.name)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((z) => {
    const desc = z.description ? ` — ${esc(clip(z.description, DESC_CHARS))}` : "";
    const href = `/?zones=${encodeURIComponent(z.code)}`;
    return `      <li><a href="${esc(href)}"><strong>${esc(z.name)}</strong></a>${desc}</li>`;
  })
  .join("\n");

const intro =
  `PlantyJ is an agentic garden journal: a photo gallery documenting ${namedPlants.length} ` +
  `plants and creatures across ${zones.filter((z) => z.name).length} garden zones, ` +
  `updated from the field. Browse the collection by species, zone, or tag.`;

const block = `<div id="root"><main class="seo-prerender" data-prerender>
    <style>
      .seo-prerender { max-width: 760px; margin: 0 auto; padding: 2rem 1.25rem;
        font-family: system-ui, sans-serif; color: #8aa085; background: #111; line-height: 1.5; }
      .seo-prerender h1 { color: #d8e6d2; font-size: 1.5rem; }
      .seo-prerender h2 { color: #b1c3ab; font-size: 1.1rem; margin-top: 2rem; }
      .seo-prerender a { color: inherit; }
      .seo-prerender li { margin: 0.4rem 0; }
    </style>
    <h1>PlantyJ: an agentic garden journal</h1>
    <p>${esc(intro)}</p>
    <nav><a href="${SITE}/">Open the gallery →</a></nav>
    <h2>Plants &amp; wildlife</h2>
    <ul>
${plantItems}
    </ul>
    <h2>Garden zones</h2>
    <ul>
${zoneItems}
    </ul>
  </main></div>`;

let html = readFileSync(distHtml, "utf8");
const target = '<div id="root"></div>';
if (!html.includes(target)) {
  console.error(`prerender: could not find ${target} in dist/index.html — skipping`);
  process.exit(0);
}
html = html.replace(target, block);
writeFileSync(distHtml, html);
console.log(`prerender: injected ${namedPlants.length} plants + ${zoneItems ? zones.length : 0} zones into dist/index.html`);
