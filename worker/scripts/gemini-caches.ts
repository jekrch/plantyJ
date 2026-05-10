#!/usr/bin/env bun
// One-off admin script to inspect and delete Gemini context caches.
//
// Usage:
//   GEMINI_API_KEY=... bun scripts/gemini-caches.ts            # list
//   GEMINI_API_KEY=... bun scripts/gemini-caches.ts delete-all
//   GEMINI_API_KEY=... bun scripts/gemini-caches.ts delete cachedContents/abc123
//
// After deletion, the worker's KV entries (cache:v2:<model>) become stale.
// ask.ts already handles this: the next request 404s, clears KV, and recreates.

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("set GEMINI_API_KEY");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const [, , mode, arg] = process.argv;

async function listAll() {
  const out: Array<{ name?: string; model?: string; expireTime?: string; displayName?: string; usageMetadata?: { totalTokenCount?: number } }> = [];
  const pager = await ai.caches.list();
  for await (const c of pager) out.push(c);
  return out;
}

if (!mode || mode === "list") {
  const caches = await listAll();
  if (caches.length === 0) {
    console.log("no caches");
  } else {
    for (const c of caches) {
      const tokens = c.usageMetadata?.totalTokenCount ?? "?";
      console.log(`${c.name}\tmodel=${c.model}\texpires=${c.expireTime}\ttokens=${tokens}`);
    }
    console.log(`\n${caches.length} cache(s). Run 'delete-all' or 'delete <name>' to remove.`);
  }
} else if (mode === "delete-all") {
  const caches = await listAll();
  let deleted = 0;
  for (const c of caches) {
    if (!c.name) continue;
    try {
      await ai.caches.delete({ name: c.name });
      console.log(`deleted ${c.name}`);
      deleted++;
    } catch (err) {
      console.log(`failed ${c.name}: ${(err as Error).message}`);
    }
  }
  console.log(`\ndone — deleted ${deleted}/${caches.length}`);
} else if (mode === "delete") {
  if (!arg) {
    console.error("usage: delete <name>");
    process.exit(1);
  }
  await ai.caches.delete({ name: arg });
  console.log(`deleted ${arg}`);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}
