import type { Env, TelegramMessage } from "../types";
import { type Replier } from "../telegram";
import { HELP_HEADER } from "../help";
import {
  handleRelate,
  handleRelations,
  handleRelType,
  handleRelTypes,
  handleUnrelate,
} from "../relationships";
import {
  handleAnalyze,
  handleAnalyzeCancel,
  handleAnalyzeLoad,
  handleAsk,
  handleAskStyle,
  handleCancel,
  handleConfirm,
  handleCost,
  handlePick,
  handleReassess,
  handleResp,
  handleShowStyle,
} from "./session";
import {
  handleAccept,
  handleAddTag,
  handleAddZone,
  handleAnnotate,
  handleDeleteAnnotation,
  handleDeletePic,
  handleDeleteZone,
  handleDeleteZonePic,
  handleDescribeZone,
  handleMerge,
  handlePlants,
  handleRemoveCombo,
  handleRemoveTag,
  handleRenameZone,
  handleTagsList,
  handleUpdate,
  handleZonesList,
} from "./garden";

/**
 * Try each registered text command in order. Returns true if one matched and
 * was handled (regardless of success/failure). Errors during a handler are
 * caught and reported as a plain "Error: …" reply.
 */
export async function handleTextCommand(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier,
): Promise<boolean> {
  const handlers: Array<[RegExp | string, () => Promise<void>]> = [
    [/^\/askstyle(\s|$)/i, () => handleAskStyle(text, message, env, reply)],
    ["/showstyle", () => handleShowStyle(message, env, reply)],
    ["/cancel", () => handleCancel(message, env, reply)],
    [/^\/confirm(\s|\t|$)/, () => handleConfirm(text, message, env, reply)],
    [/^\/pick\s+\d+$/, () => handlePick(text, message, env, reply)],
    [/^\/ask([123])?\s/i, () => handleAsk(text, message, env, reply)],
    [/^\/resp([123])?\s/i, () => handleResp(text, message, env, reply)],
    ["/analyze-load", () => handleAnalyzeLoad(env, reply)],
    ["/analyze-cancel", () => handleAnalyzeCancel(env, reply)],
    [/^\/analyze(\s|$)/i, () => handleAnalyze(text, message, env, reply)],
    [/^\/reassess(\s|$)/i, () => handleReassess(text, message, env, reply)],
    [
      /^\/(help|start)$/,
      async () => {
        await reply(HELP_HEADER);
      },
    ],
    ["/cost", () => handleCost(env, reply)],
    ["/plants", () => handlePlants(env, reply)],
    ["/tags", () => handleTagsList(env, reply)],
    ["/zones", () => handleZonesList(env, reply)],
    [/^\/addzone\s/, () => handleAddZone(text, env, reply)],
    [/^\/renamezone\s/, () => handleRenameZone(text, env, reply)],
    [/^\/describezone\s/, () => handleDescribeZone(text, env, reply)],
    [/^\/deletezonepic\s/, () => handleDeleteZonePic(text, env, reply)],
    [/^\/deletezone\s/, () => handleDeleteZone(text, env, reply)],
    [/^\/delete\s+\d+$/, () => handleDeletePic(text, env, reply)],
    [/^\/accept\s/, () => handleAccept(text, env, reply)],
    [/^\/update\s/, () => handleUpdate(text, env, reply)],
    [/^\/merge\s/, () => handleMerge(text, env, reply)],
    [/^\/annotate\s/, () => handleAnnotate(text, env, reply)],
    [/^\/addtag\s/, () => handleAddTag(text, env, reply)],
    [/^\/removetag\s/, () => handleRemoveTag(text, env, reply)],
    [/^\/deleteannotation\s/, () => handleDeleteAnnotation(text, env, reply)],
    [/^\/remove\s/, () => handleRemoveCombo(text, env, reply, true)],
    [/^\/restore\s/, () => handleRemoveCombo(text, env, reply, false)],
    [/^\/relate\s/, () => handleRelate(text, env, reply)],
    [/^\/unrelate\s/, () => handleUnrelate(text, env, reply)],
    [/^\/relations\s/, () => handleRelations(text, env, reply)],
    ["/reltypes", () => handleRelTypes(env, reply)],
    [/^\/reltype\s/, () => handleRelType(text, env, reply)],
  ];

  for (const [pattern, run] of handlers) {
    const matched = typeof pattern === "string" ? text === pattern : pattern.test(text);
    if (!matched) continue;
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await reply(`Error: ${msg}`);
    }
    return true;
  }
  return false;
}
