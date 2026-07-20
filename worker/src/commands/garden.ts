// Handlers that read or mutate garden content: the list commands, zone CRUD,
// pic edits, annotations, and the removed/restored combo flags. These are
// stateless — every one derives its whole effect from the command text.
import type { Env } from "../types";
import { type Replier } from "../telegram";
import { runBatch } from "../batch";
import { assertValidCode } from "../validation";
import {
  acceptBioclip,
  addAnnotationTag,
  addPicTag,
  removeAnnotationTag,
  removePicTag,
  deleteAnnotation,
  deletePic,
  deleteZone,
  deleteZonePic,
  readAnnotations,
  readGallery,
  setAnnotationRemoved,
  setZoneDescription,
  upsertAnnotation,
  upsertZone,
} from "../github";
import { buildPlantsText, buildTagsText, buildZonesText, joinLines } from "./format";
import { COMBO_USAGE, parseComboCommand, parseTagCommand, TAG_USAGE } from "./parse";

export async function handlePlants(env: Env, reply: Replier): Promise<void> {
  const { gallery } = await readGallery(env);
  await reply(buildPlantsText(gallery.plants));
}

export async function handleTagsList(env: Env, reply: Replier): Promise<void> {
  const [{ gallery }, annotations] = await Promise.all([readGallery(env), readAnnotations(env)]);
  await reply(buildTagsText(gallery.pics, annotations));
}

export async function handleZonesList(env: Env, reply: Replier): Promise<void> {
  const { gallery } = await readGallery(env);
  await reply(buildZonesText(gallery.zones));
}

export async function handleAddZone(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/addzone\s+(\S+)(?:\s+(\S[\s\S]*))?$/)!;
  const code = m[1];
  assertValidCode("zoneCode", code);
  const name = m[2]?.trim() || null;
  const zone = await upsertZone(env, code, name);
  await reply(`Saved zone: ${zone.code}${zone.name ? ` — ${zone.name}` : ""}`);
}

export async function handleRenameZone(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/renamezone\s+(\S+)\s+(\S[\s\S]*)$/)!;
  const code = m[1];
  assertValidCode("zoneCode", code);
  const name = m[2].trim();
  const zone = await upsertZone(env, code, name || null);
  await reply(`Zone ${zone.code} renamed to "${zone.name}"`);
}

export async function handleDescribeZone(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/describezone\s+(\S+)\s*\/\/\s*([\s\S]*)$/);
  if (!m) {
    await reply(
      `Invalid format. Use:\n  /describezone {code} // {description}\n  /describezone {code} // -   (to clear)`,
    );
    return;
  }
  const code = m[1];
  assertValidCode("zoneCode", code);
  const raw = m[2].trim();
  const description = raw === "" || raw === "-" ? null : raw;
  const zone = await setZoneDescription(env, code, description);
  await reply(
    description
      ? `Zone ${zone.code} description set:\n${zone.description}`
      : `Cleared description for zone ${zone.code}.`,
  );
}

export async function handleDeleteZonePic(text: string, env: Env, reply: Replier): Promise<void> {
  const id = text.match(/^\/deletezonepic\s+(\S+)$/)![1];
  const removed = await deleteZonePic(env, id);
  await reply(
    removed
      ? `Deleted zone pic: ${removed.zoneCode} (${removed.id})`
      : `No zone pic found with id ${id}.`,
  );
}

export async function handleDeleteZone(text: string, env: Env, reply: Replier): Promise<void> {
  const code = text.match(/^\/deletezone\s+(\S+)$/)![1];
  assertValidCode("zoneCode", code);
  const result = await deleteZone(env, code);
  if (!result.zone) {
    await reply(`No zone found with code "${code}".`);
  } else if (result.inUseBy.length > 0) {
    const refs = Array.from(new Set(result.inUseBy)).join(", ");
    await reply(`Cannot delete zone "${code}" — still used by: ${refs}`);
  } else {
    await reply(`Deleted zone: ${code}`);
  }
}

export async function handleDeletePic(text: string, env: Env, reply: Replier): Promise<void> {
  const seq = parseInt(text.match(/^\/delete\s+(\d+)$/)![1], 10);
  const removed = await deletePic(env, seq);
  await reply(
    removed ? `Deleted pic #${seq}: ${removed.shortCode}` : `No pic found with ID ${seq}.`,
  );
}

export async function handleAccept(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/accept\s+(\d+)(?:\s+(\S+))?$/)!;
  const seq = parseInt(m[1], 10);
  const targetShortCode = m[2] || null;
  if (targetShortCode) assertValidCode("shortCode", targetShortCode);
  const result = await acceptBioclip(env, seq, targetShortCode);

  if (result === "no-pic") {
    await reply(`No pic found with ID ${seq}.`);
    return;
  }
  if (result === "no-prediction") {
    await reply(
      `Pic #${seq} has no BioCLIP prediction yet. The metadata action runs after each commit — try again in a few minutes.`,
    );
    return;
  }
  await reply(
    joinLines([
      result.renamedFrom
        ? `Accepted #${seq}: ${result.renamedFrom} → ${result.plant.shortCode}`
        : `Accepted #${seq}: ${result.plant.shortCode}`,
      result.plant.fullName ? `  Full: ${result.plant.fullName}` : null,
      result.plant.commonName ? `  Common: ${result.plant.commonName}` : null,
    ]),
  );
}

export async function handleUpdate(text: string, env: Env, reply: Replier): Promise<void> {
  const m = text.match(/^\/update\s+(\d+)\s+(\S+)\s+(\S[\s\S]*)$/)!;
  const seq = parseInt(m[1], 10);
  const field = m[2];
  // Route through the shared batch path so a single direct /update applies the
  // exact same logic as a /confirm'd one — including the shortCode rename that
  // also repoints annotations and relationships. (loadBatchState + a single
  // dirty-file commit; well under the subrequest budget for one command.)
  const { results } = await runBatch(env, [text], `Update pic #${seq}: ${field}`);
  await reply(results[0].reply);
}

export async function handleMerge(text: string, env: Env, reply: Replier): Promise<void> {
  const parts = text
    .slice("/merge".length)
    .trim()
    .split("//")
    .map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    await reply("Usage: /merge <fromCode> // <toCode>");
    return;
  }
  const { results } = await runBatch(env, [text], `Merge ${parts[0]} → ${parts[1]}`);
  await reply(results[0].reply);
}

export async function handleAnnotate(text: string, env: Env, reply: Replier): Promise<void> {
  const parts = text
    .slice("/annotate ".length)
    .split("//")
    .map((s) => s.trim());
  const isField = (s: string): s is "tags" | "description" => s === "tags" || s === "description";

  let shortCode: string, zoneCode: string | null, field: "tags" | "description", value: string;

  if (parts.length >= 3 && isField(parts[1])) {
    shortCode = parts[0];
    zoneCode = null;
    field = parts[1];
    value = parts.slice(2).join("//");
  } else if (parts.length >= 4 && isField(parts[2])) {
    shortCode = parts[0];
    zoneCode = parts[1];
    field = parts[2];
    value = parts.slice(3).join("//");
  } else {
    await reply(
      `Invalid format. Use:\n  /annotate shortCode // tags // value\n  /annotate shortCode // zoneCode // tags // value`,
    );
    return;
  }

  assertValidCode("shortCode", shortCode);
  if (zoneCode) assertValidCode("zoneCode", zoneCode);

  const entry = await upsertAnnotation(
    env,
    shortCode,
    zoneCode,
    field,
    value.trim() === "-" ? "" : value,
  );
  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  const lines = joinLines([
    `Annotated ${scope}:`,
    entry.tags.length > 0 ? `  Tags: ${entry.tags.join(", ")}` : null,
    entry.description ? `  Note: ${entry.description}` : null,
  ]);
  await reply(lines || `Cleared annotation for ${scope}.`);
}

export async function handleAddTag(text: string, env: Env, reply: Replier): Promise<void> {
  const target = parseTagCommand(text.slice("/addtag ".length));
  if (target.kind === "invalid") {
    await reply(TAG_USAGE("addtag"));
    return;
  }
  if (target.kind === "pic") {
    const pic = await addPicTag(env, target.seq, target.tag);
    await reply(
      pic
        ? `Added tag "${target.tag}" to pic #${target.seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`
        : `No pic found with ID ${target.seq}.`,
    );
    return;
  }
  assertValidCode("shortCode", target.shortCode);
  if (target.zoneCode) assertValidCode("zoneCode", target.zoneCode);
  const { entry, added } = await addAnnotationTag(
    env,
    target.shortCode,
    target.zoneCode,
    target.tag,
  );
  const scope = target.zoneCode ? `${target.shortCode} / ${target.zoneCode}` : target.shortCode;
  await reply(
    added
      ? `Added tag "${target.tag}" to ${scope}. Tags: ${entry.tags.join(", ")}`
      : `Tag "${target.tag}" already present on ${scope}.`,
  );
}

export async function handleRemoveTag(text: string, env: Env, reply: Replier): Promise<void> {
  const target = parseTagCommand(text.slice("/removetag ".length));
  if (target.kind === "invalid") {
    await reply(TAG_USAGE("removetag"));
    return;
  }
  if (target.kind === "pic") {
    const result = await removePicTag(env, target.seq, target.tag);
    if (!result) {
      await reply(`No pic found with ID ${target.seq}.`);
    } else if (!result.removed) {
      await reply(
        `Tag "${target.tag}" not present on pic #${target.seq} (${result.pic.shortCode}).`,
      );
    } else {
      const tags = result.pic.tags.length > 0 ? result.pic.tags.join(", ") : "(none)";
      await reply(
        `Removed tag "${target.tag}" from pic #${target.seq} (${result.pic.shortCode}). Tags: ${tags}`,
      );
    }
    return;
  }
  assertValidCode("shortCode", target.shortCode);
  if (target.zoneCode) assertValidCode("zoneCode", target.zoneCode);
  const { entry, removed } = await removeAnnotationTag(
    env,
    target.shortCode,
    target.zoneCode,
    target.tag,
  );
  const scope = target.zoneCode ? `${target.shortCode} / ${target.zoneCode}` : target.shortCode;
  if (!removed) {
    await reply(`Tag "${target.tag}" not present on ${scope}.`);
  } else {
    const tags = entry && entry.tags.length > 0 ? entry.tags.join(", ") : "(none)";
    await reply(`Removed tag "${target.tag}" from ${scope}. Tags: ${tags}`);
  }
}

export async function handleDeleteAnnotation(text: string, env: Env, reply: Replier): Promise<void> {
  const parts = text
    .slice("/deleteannotation ".length)
    .split("//")
    .map((s) => s.trim());
  const shortCode = parts[0];
  const zoneCode = parts[1] || null;
  assertValidCode("shortCode", shortCode);
  if (zoneCode) assertValidCode("zoneCode", zoneCode);
  const removed = await deleteAnnotation(env, shortCode, zoneCode);
  const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
  await reply(removed ? `Deleted annotation for ${scope}.` : `No annotation found for ${scope}.`);
}

export async function handleRemoveCombo(
  text: string,
  env: Env,
  reply: Replier,
  removed: boolean,
): Promise<void> {
  const verb = removed ? "remove" : "restore";
  const combo = parseComboCommand(text.slice(`/${verb} `.length));
  if (!combo) {
    await reply(COMBO_USAGE(verb));
    return;
  }
  assertValidCode("shortCode", combo.shortCode);
  assertValidCode("zoneCode", combo.zoneCode);
  const { changed } = await setAnnotationRemoved(env, combo.shortCode, combo.zoneCode, removed);
  const scope = `${combo.shortCode} / ${combo.zoneCode}`;
  if (removed) {
    await reply(
      changed
        ? `Marked ${scope} as removed. Its photos still appear in the gallery (flagged) but it's filtered out of the web, tree, and zone/plant views.`
        : `${scope} is already marked removed.`,
    );
  } else {
    await reply(
      changed
        ? `Restored ${scope}. It's back in the web, tree, and zone/plant views.`
        : `${scope} was not marked removed.`,
    );
  }
}
