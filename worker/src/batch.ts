import type { Env, AnnotationEntry, PlantRecord, Zone } from "./types";
import {
  loadBatchState,
  commitBatchState,
  isUpdatableField,
  type BatchState,
} from "./github";

// In-memory mirror of executeCommand. Each mutator operates on a shared
// BatchState (loaded once per chunk) and marks which JSON files got dirty.
// commitBatchState then writes only the dirty files at the end of the chunk —
// turning ~6 GitHub subrequests per command into ~6 per chunk.

interface ExecResult {
  ok: boolean;
  reply: string;
}

function ok(reply: string): ExecResult {
  return { ok: true, reply };
}
function fail(reply: string): ExecResult {
  return { ok: false, reply };
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function findOrCreateAnnotation(
  state: BatchState,
  shortCode: string,
  zoneCode: string | null
): { entry: AnnotationEntry; created: boolean } {
  const idx = state.annotations.findIndex(
    (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
  );
  if (idx === -1) {
    const entry: AnnotationEntry = { shortCode, zoneCode, tags: [], description: null };
    state.annotations.push(entry);
    return { entry, created: true };
  }
  return { entry: state.annotations[idx], created: false };
}

function applyCommand(state: BatchState, text: string): ExecResult {
  const trimmed = text.trim();

  // /addzone {code} [name]
  const addZoneMatch = trimmed.match(/^\/addzone\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (addZoneMatch) {
    const code = addZoneMatch[1];
    const name = addZoneMatch[2]?.trim() || null;
    const idx = state.gallery.zones.findIndex((z) => z.code === code);
    let zone: Zone;
    if (idx === -1) {
      zone = { code, name };
      state.gallery.zones.push(zone);
    } else {
      zone = { ...state.gallery.zones[idx], name };
      state.gallery.zones[idx] = zone;
    }
    state.dirty.add("zones");
    return ok(`Saved zone: ${zone.code}${zone.name ? ` — ${zone.name}` : ""}`);
  }

  // /renamezone {code} {name}
  const renameZoneMatch = trimmed.match(/^\/renamezone\s+(\S+)\s+([\s\S]+)$/);
  if (renameZoneMatch) {
    const code = renameZoneMatch[1];
    const name = renameZoneMatch[2].trim() || null;
    const idx = state.gallery.zones.findIndex((z) => z.code === code);
    let zone: Zone;
    if (idx === -1) {
      zone = { code, name };
      state.gallery.zones.push(zone);
    } else {
      zone = { ...state.gallery.zones[idx], name };
      state.gallery.zones[idx] = zone;
    }
    state.dirty.add("zones");
    return ok(`Zone ${zone.code} renamed to "${zone.name}"`);
  }

  // /deletezonepic {id}
  const deleteZonePicMatch = trimmed.match(/^\/deletezonepic\s+(\S+)$/);
  if (deleteZonePicMatch) {
    const id = deleteZonePicMatch[1];
    const idx = state.gallery.zonePics.findIndex((p) => p.id === id);
    if (idx === -1) return fail(`No zone pic found with id ${id}.`);
    const [removed] = state.gallery.zonePics.splice(idx, 1);
    state.dirty.add("zonePics");
    state.imagesToDelete.push({
      path: `public/${removed.image}`,
      message: `Delete zone image: ${removed.zoneCode} (${removed.id})`,
    });
    return ok(`Deleted zone pic: ${removed.zoneCode} (${removed.id})`);
  }

  // /delete {seq}
  const deleteMatch = trimmed.match(/^\/delete\s+(\d+)$/);
  if (deleteMatch) {
    const seq = parseInt(deleteMatch[1], 10);
    const idx = state.gallery.pics.findIndex((p) => p.seq === seq);
    if (idx === -1) return fail(`No pic found with ID ${seq}.`);
    const [removed] = state.gallery.pics.splice(idx, 1);
    state.dirty.add("pics");
    state.imagesToDelete.push({
      path: `public/${removed.image}`,
      message: `Delete image: ${removed.shortCode} (#${removed.seq})`,
    });
    return ok(`Deleted pic #${seq}: ${removed.shortCode}`);
  }

  // /accept {seq} [shortCode]
  const acceptMatch = trimmed.match(/^\/accept\s+(\d+)(?:\s+(\S+))?$/);
  if (acceptMatch) {
    const seq = parseInt(acceptMatch[1], 10);
    const targetShortCode = acceptMatch[2] || null;
    const pic = state.gallery.pics.find((p) => p.seq === seq);
    if (!pic) return fail(`No pic found with ID ${seq}.`);

    const speciesId = pic.bioclipSpeciesId?.trim() || null;
    const commonName = pic.bioclipCommonName?.trim() || null;
    if (!speciesId && !commonName)
      return fail(`Pic #${seq} has no BioCLIP prediction yet.`);

    const newCode = targetShortCode?.trim() || null;
    const oldCode = pic.shortCode;
    const finalCode = newCode ?? oldCode;
    let renamedFrom: string | null = null;

    if (newCode && newCode !== oldCode) {
      renamedFrom = oldCode;
      for (const p of state.gallery.pics) {
        if (p.shortCode === oldCode) {
          p.shortCode = newCode;
          state.dirty.add("pics");
        }
      }
      const oldPlantIdx = state.gallery.plants.findIndex((p) => p.shortCode === oldCode);
      if (oldPlantIdx !== -1) {
        state.gallery.plants.splice(oldPlantIdx, 1);
        state.dirty.add("plants");
      }
    }

    const existingIdx = state.gallery.plants.findIndex((p) => p.shortCode === finalCode);
    let plant: PlantRecord;
    if (existingIdx === -1) {
      plant = { shortCode: finalCode, fullName: speciesId, commonName };
      state.gallery.plants.unshift(plant);
      state.dirty.add("plants");
    } else {
      const existing = state.gallery.plants[existingIdx];
      const merged: PlantRecord = {
        shortCode: finalCode,
        fullName: existing.fullName ?? speciesId,
        commonName: existing.commonName ?? commonName,
      };
      if (
        merged.fullName !== existing.fullName ||
        merged.commonName !== existing.commonName
      ) {
        state.gallery.plants[existingIdx] = merged;
        state.dirty.add("plants");
      }
      plant = merged;
    }

    const lines = [
      renamedFrom
        ? `Accepted #${seq}: ${renamedFrom} → ${plant.shortCode}`
        : `Accepted #${seq}: ${plant.shortCode}`,
      plant.fullName ? `  Full: ${plant.fullName}` : null,
      plant.commonName ? `  Common: ${plant.commonName}` : null,
    ].filter(Boolean);
    return ok(lines.join("\n"));
  }

  // /update {seq} {field} {value}
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
    const pic = state.gallery.pics.find((p) => p.seq === seq);
    if (!pic) return fail(`No pic found with ID ${seq}.`);

    const PIC_FIELDS = ["zoneCode", "tags", "description"] as const;
    const isPicField = (f: string): f is (typeof PIC_FIELDS)[number] =>
      (PIC_FIELDS as readonly string[]).includes(f);

    if (isPicField(field)) {
      switch (field) {
        case "zoneCode": {
          const code = value.trim();
          if (!code) return fail("zoneCode must be a non-empty zone code.");
          if (code.includes(",") || code.includes("+")) {
            return fail("zoneCode is a single value — a picture belongs to one zone.");
          }
          if (!state.gallery.zones.some((z) => z.code === code)) {
            state.gallery.zones.push({ code, name: null });
            state.dirty.add("zones");
          }
          pic.zoneCode = code;
          break;
        }
        case "tags":
          pic.tags = parseList(value);
          break;
        case "description":
          pic.description = value || null;
          break;
      }
      state.dirty.add("pics");
      return ok(`Updated pic #${seq}: ${field} → "${value}"\n→ ${pic.shortCode}`);
    }

    // Plant-level field
    const plantIdx = state.gallery.plants.findIndex((p) => p.shortCode === pic.shortCode);
    if (plantIdx === -1) {
      return fail(
        `Plant "${pic.shortCode}" not found in plants.json — cannot update ${field}.`
      );
    }
    const plant = state.gallery.plants[plantIdx];

    switch (field) {
      case "shortCode": {
        const newCode = value.trim();
        if (!newCode) return fail("shortCode must be non-empty.");
        if (newCode === plant.shortCode) {
          return ok(`Updated pic #${seq}: ${field} → "${value}"\n→ ${pic.shortCode}`);
        }
        if (state.gallery.plants.some((p) => p.shortCode === newCode)) {
          return fail(`shortCode "${newCode}" already exists.`);
        }
        const oldCode = plant.shortCode;
        plant.shortCode = newCode;
        for (const p of state.gallery.pics) {
          if (p.shortCode === oldCode) p.shortCode = newCode;
        }
        state.dirty.add("plants");
        state.dirty.add("pics");
        return ok(`Updated pic #${seq}: ${field} → "${value}"\n→ ${pic.shortCode}`);
      }
      case "fullName":
        plant.fullName = value || null;
        break;
      case "commonName":
        plant.commonName = value || null;
        break;
      case "variety":
        plant.variety = value || null;
        break;
    }
    state.dirty.add("plants");
    return ok(`Updated pic #${seq}: ${field} → "${value}"\n→ ${pic.shortCode}`);
  }

  // /annotate shortCode // [zoneCode //] field // value
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
    const cleared = value.trim() === "-";
    const { entry } = findOrCreateAnnotation(state, shortCode, zoneCode);
    if (field === "tags") {
      entry.tags = cleared ? [] : parseList(value);
    } else {
      entry.description = cleared ? null : value.trim() || null;
    }
    state.dirty.add("annotations");
    const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
    const lines = [
      `Annotated ${scope}:`,
      entry.tags.length > 0 ? `  Tags: ${entry.tags.join(", ")}` : null,
      entry.description ? `  Note: ${entry.description}` : null,
    ].filter(Boolean);
    return ok(lines.join("\n") || `Cleared annotation for ${scope}.`);
  }

  // /addtag — three forms
  if (trimmed.startsWith("/addtag ")) {
    const parts = trimmed.slice("/addtag ".length).split("//").map((s) => s.trim());

    if (parts.length === 1) {
      const spaceIdx = parts[0].indexOf(" ");
      if (spaceIdx === -1) return fail(`Invalid /addtag format.`);
      const first = parts[0].slice(0, spaceIdx).trim();
      const tag = parts[0].slice(spaceIdx + 1).trim();
      const seq = parseInt(first, 10);
      if (!isNaN(seq) && String(seq) === first) {
        const pic = state.gallery.pics.find((p) => p.seq === seq);
        if (!pic) return fail(`No pic found with ID ${seq}.`);
        if (pic.tags.includes(tag)) {
          return ok(`Added tag "${tag}" to pic #${seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`);
        }
        pic.tags = [...pic.tags, tag];
        state.dirty.add("pics");
        return ok(`Added tag "${tag}" to pic #${seq} (${pic.shortCode}). Tags: ${pic.tags.join(", ")}`);
      }
      // plant-level annotation tag
      const { entry } = findOrCreateAnnotation(state, first, null);
      if (entry.tags.includes(tag)) {
        return fail(`Tag "${tag}" already present on ${first}.`);
      }
      entry.tags = [...entry.tags, tag];
      state.dirty.add("annotations");
      return ok(`Added tag "${tag}" to ${first}. Tags: ${entry.tags.join(", ")}`);
    }

    if (parts.length === 2) {
      const [shortCode, tag] = parts;
      const { entry } = findOrCreateAnnotation(state, shortCode, null);
      if (entry.tags.includes(tag)) {
        return fail(`Tag "${tag}" already present on ${shortCode}.`);
      }
      entry.tags = [...entry.tags, tag];
      state.dirty.add("annotations");
      return ok(`Added tag "${tag}" to ${shortCode}. Tags: ${entry.tags.join(", ")}`);
    }

    if (parts.length === 3) {
      const [shortCode, zoneCode, tag] = parts;
      const { entry } = findOrCreateAnnotation(state, shortCode, zoneCode);
      const scope = `${shortCode} / ${zoneCode}`;
      if (entry.tags.includes(tag)) {
        return fail(`Tag "${tag}" already present on ${scope}.`);
      }
      entry.tags = [...entry.tags, tag];
      state.dirty.add("annotations");
      return ok(`Added tag "${tag}" to ${scope}. Tags: ${entry.tags.join(", ")}`);
    }
    return fail(`Invalid /addtag format.`);
  }

  // /removetag — three forms (mirrors /addtag)
  if (trimmed.startsWith("/removetag ")) {
    const parts = trimmed.slice("/removetag ".length).split("//").map((s) => s.trim());

    const removeFromAnnotation = (
      shortCode: string,
      zoneCode: string | null,
      tag: string
    ): ExecResult => {
      const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
      const idx = state.annotations.findIndex(
        (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
      );
      if (idx === -1) return ok(`Tag "${tag}" not present on ${scope}.`);
      const existing = state.annotations[idx];
      if (!existing.tags.includes(tag)) return ok(`Tag "${tag}" not present on ${scope}.`);
      const updated = { ...existing, tags: existing.tags.filter((t) => t !== tag) };
      if (updated.tags.length === 0 && updated.description === null) {
        state.annotations.splice(idx, 1);
      } else {
        state.annotations[idx] = updated;
      }
      state.dirty.add("annotations");
      const tags = updated.tags.length > 0 ? updated.tags.join(", ") : "(none)";
      return ok(`Removed tag "${tag}" from ${scope}. Tags: ${tags}`);
    };

    if (parts.length === 1) {
      const spaceIdx = parts[0].indexOf(" ");
      if (spaceIdx === -1) return fail(`Invalid /removetag format.`);
      const first = parts[0].slice(0, spaceIdx).trim();
      const tag = parts[0].slice(spaceIdx + 1).trim();
      const seq = parseInt(first, 10);
      if (!isNaN(seq) && String(seq) === first) {
        const pic = state.gallery.pics.find((p) => p.seq === seq);
        if (!pic) return fail(`No pic found with ID ${seq}.`);
        if (!pic.tags.includes(tag)) {
          return ok(`Tag "${tag}" not present on pic #${seq} (${pic.shortCode}).`);
        }
        pic.tags = pic.tags.filter((t) => t !== tag);
        state.dirty.add("pics");
        const tags = pic.tags.length > 0 ? pic.tags.join(", ") : "(none)";
        return ok(`Removed tag "${tag}" from pic #${seq} (${pic.shortCode}). Tags: ${tags}`);
      }
      return removeFromAnnotation(first, null, tag);
    }

    if (parts.length === 2) {
      return removeFromAnnotation(parts[0], null, parts[1]);
    }

    if (parts.length === 3) {
      return removeFromAnnotation(parts[0], parts[1], parts[2]);
    }
    return fail(`Invalid /removetag format.`);
  }

  // /deleteannotation shortCode [// zoneCode]
  if (trimmed.startsWith("/deleteannotation ")) {
    const parts = trimmed.slice("/deleteannotation ".length).split("//").map((s) => s.trim());
    const shortCode = parts[0];
    const zoneCode = parts[1] || null;
    const idx = state.annotations.findIndex(
      (a) => a.shortCode === shortCode && a.zoneCode === zoneCode
    );
    const scope = zoneCode ? `${shortCode} / ${zoneCode}` : shortCode;
    if (idx === -1) return fail(`No annotation found for ${scope}.`);
    state.annotations.splice(idx, 1);
    state.dirty.add("annotations");
    return ok(`Deleted annotation for ${scope}.`);
  }

  const verb = trimmed.split(/\s+/)[0];
  return fail(`Could not parse: "${trimmed}" (verb=${verb})`);
}

export interface BatchRunResult {
  results: ExecResult[];
  jsonWrites: number;
  imagesDeleted: number;
}

export async function runBatch(
  env: Env,
  commands: string[],
  commitMessage: string
): Promise<BatchRunResult> {
  const state = await loadBatchState(env);
  const results: ExecResult[] = [];
  for (const cmd of commands) {
    try {
      results.push(applyCommand(state, cmd));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      results.push(fail(msg));
    }
  }
  const { jsonWrites, imagesDeleted } = await commitBatchState(env, state, commitMessage);
  return { results, jsonWrites, imagesDeleted };
}
