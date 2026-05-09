import type { Env } from "./types";
import {
  acceptBioclip,
  addAnnotationTag,
  addPicTag,
  deleteAnnotation,
  deletePic,
  deleteZonePic,
  isUpdatableField,
  updateBySeq,
  upsertAnnotation,
  upsertZone,
} from "./github";

export interface ExecResult {
  ok: boolean;
  reply: string;
}

function ok(reply: string): ExecResult {
  return { ok: true, reply };
}

function fail(reply: string): ExecResult {
  return { ok: false, reply };
}

// Runs a single slash command from the /do propose-confirm flow. Mirrors the
// inline handlers in handleUpdate but returns the reply text instead of
// sending it. Only the mutating subset is supported; any other verb is rejected.
export async function executeCommand(text: string, env: Env): Promise<ExecResult> {
  const trimmed = text.trim();

  const addZoneMatch = trimmed.match(/^\/addzone\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (addZoneMatch) {
    const code = addZoneMatch[1];
    const name = addZoneMatch[2]?.trim() || null;
    const zone = await upsertZone(env, code, name);
    return ok(`Saved zone: ${zone.code}${zone.name ? ` — ${zone.name}` : ""}`);
  }

  const renameZoneMatch = trimmed.match(/^\/renamezone\s+(\S+)\s+([\s\S]+)$/);
  if (renameZoneMatch) {
    const code = renameZoneMatch[1];
    const name = renameZoneMatch[2].trim();
    const zone = await upsertZone(env, code, name || null);
    return ok(`Zone ${zone.code} renamed to "${zone.name}"`);
  }

  const deleteZonePicMatch = trimmed.match(/^\/deletezonepic\s+(\S+)$/);
  if (deleteZonePicMatch) {
    const id = deleteZonePicMatch[1];
    const removed = await deleteZonePic(env, id);
    return removed
      ? ok(`Deleted zone pic: ${removed.zoneCode} (${removed.id})`)
      : fail(`No zone pic found with id ${id}.`);
  }

  const deleteMatch = trimmed.match(/^\/delete\s+(\d+)$/);
  if (deleteMatch) {
    const seq = parseInt(deleteMatch[1], 10);
    const removed = await deletePic(env, seq);
    return removed
      ? ok(`Deleted pic #${seq}: ${removed.shortCode}`)
      : fail(`No pic found with ID ${seq}.`);
  }

  const acceptMatch = trimmed.match(/^\/accept\s+(\d+)(?:\s+(\S+))?$/);
  if (acceptMatch) {
    const seq = parseInt(acceptMatch[1], 10);
    const targetShortCode = acceptMatch[2] || null;
    const result = await acceptBioclip(env, seq, targetShortCode);
    if (result === "no-pic") return fail(`No pic found with ID ${seq}.`);
    if (result === "no-prediction")
      return fail(`Pic #${seq} has no BioCLIP prediction yet.`);
    const lines = [
      result.renamedFrom
        ? `Accepted #${seq}: ${result.renamedFrom} → ${result.plant.shortCode}`
        : `Accepted #${seq}: ${result.plant.shortCode}`,
      result.plant.fullName ? `  Full: ${result.plant.fullName}` : null,
      result.plant.commonName ? `  Common: ${result.plant.commonName}` : null,
    ].filter(Boolean);
    return ok(lines.join("\n"));
  }

  const updateMatch = trimmed.match(/^\/update\s+(\d+)\s+(\S+)\s+([\s\S]+)$/);
  if (updateMatch) {
    const seq = parseInt(updateMatch[1], 10);
    const field = updateMatch[2];
    const value = updateMatch[3].trim();
    if (!isUpdatableField(field)) {
      return fail(
        `Invalid field "${field}". Updatable: shortCode, fullName, commonName, zoneCode, tags, description`
      );
    }
    const updated = await updateBySeq(env, seq, field, value);
    return updated
      ? ok(`Updated pic #${seq}: ${field} → "${value}"\n→ ${updated.pic.shortCode}`)
      : fail(`No pic found with ID ${seq}.`);
  }

  if (trimmed.startsWith("/annotate ")) {
    const parts = trimmed.slice("/annotate ".length).split("//").map((s) => s.trim());
    const isField = (s: string): s is "tags" | "description" =>
      s === "tags" || s === "description";

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
      return fail(
        `Invalid /annotate format. Use:\n  /annotate shortCode // tags // value\n  /annotate shortCode // zoneCode // tags // value`
      );
    }
    const entry = await upsertAnnotation(
      env,
      shortCode,
      zoneCode,
      field,
      value.trim() === "-" ? "" : value
    );
    const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
    const lines = [
      `Annotated ${scope}:`,
      entry.tags.length > 0 ? `  Tags: ${entry.tags.join(", ")}` : null,
      entry.description ? `  Note: ${entry.description}` : null,
    ].filter(Boolean);
    return ok(lines.join("\n") || `Cleared annotation for ${scope}.`);
  }

  if (trimmed.startsWith("/addtag ")) {
    const parts = trimmed.slice("/addtag ".length).split("//").map((s) => s.trim());
    if (parts.length === 1) {
      const spaceIdx = parts[0].indexOf(" ");
      if (spaceIdx === -1) {
        return fail(`Invalid /addtag format.`);
      }
      const first = parts[0].slice(0, spaceIdx).trim();
      const tag = parts[0].slice(spaceIdx + 1).trim();
      const seq = parseInt(first, 10);
      if (!isNaN(seq) && String(seq) === first) {
        const pic = await addPicTag(env, seq, tag);
        return pic
          ? ok(`Added tag "${tag}" to pic #${seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`)
          : fail(`No pic found with ID ${seq}.`);
      }
      const { entry, added } = await addAnnotationTag(env, first, null, tag);
      return added
        ? ok(`Added tag "${tag}" to ${first}. Tags: ${entry.tags.join(", ")}`)
        : fail(`Tag "${tag}" already present on ${first}.`);
    } else if (parts.length === 2) {
      const { entry, added } = await addAnnotationTag(env, parts[0], null, parts[1]);
      return added
        ? ok(`Added tag "${parts[1]}" to ${parts[0]}. Tags: ${entry.tags.join(", ")}`)
        : fail(`Tag "${parts[1]}" already present on ${parts[0]}.`);
    } else if (parts.length === 3) {
      const { entry, added } = await addAnnotationTag(env, parts[0], parts[1], parts[2]);
      const scope = `${parts[0]} / ${parts[1]}`;
      return added
        ? ok(`Added tag "${parts[2]}" to ${scope}. Tags: ${entry.tags.join(", ")}`)
        : fail(`Tag "${parts[2]}" already present on ${scope}.`);
    }
    return fail(`Invalid /addtag format.`);
  }

  if (trimmed.startsWith("/deleteannotation ")) {
    const parts = trimmed.slice("/deleteannotation ".length).split("//").map((s) => s.trim());
    const shortCode = parts[0];
    const zoneCode = parts[1] || null;
    const removed = await deleteAnnotation(env, shortCode, zoneCode);
    const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
    return removed
      ? ok(`Deleted annotation for ${scope}.`)
      : fail(`No annotation found for ${scope}.`);
  }

  const verb = trimmed.split(/\s+/)[0];
  return fail(`Could not parse: "${trimmed}" (verb=${verb})`);
}
