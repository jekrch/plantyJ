// The worker's entire write path to the plantyJ repo, via the GitHub Contents
// API. Split by concern; this barrel is the only entry point callers use.
//
//   client.ts      transport — auth, read/write/delete of a single file
//   encoding.ts    base64 <-> UTF-8 (btoa is Latin-1 only; see the note there)
//   paths.ts       repo paths for every manifest
//   fields.ts      which fields /update accepts, and where each one lives
//   gallery.ts     pics.json + plants.json + zones.json + zone_pics.json
//   updates.ts     /update and /accept — the field-level edit paths
//   zones.ts       zone records and zone pics
//   annotations.ts annotations.json (plant+zone notes, tags, removed flags)
//   batchState.ts  read-once / mutate-in-memory / write-dirty-only batching
//   analyses.ts    ai_analysis.json and the rollup read

export { arrayBufferToBase64 } from "./encoding";
export { commitFile } from "./client";

export {
  addPicTag,
  appendPic,
  applyZoneUpserts,
  deletePic,
  nextSeq,
  readGallery,
  removePicTag,
  upsertPlantRecord,
  type ReadResult,
} from "./gallery";

export {
  isUpdatableField,
  parseList,
  UPDATABLE_FIELD_LIST,
  type UpdatableField,
} from "./fields";

export { acceptBioclip, updateBySeq, type AcceptResult, type UpdateResult } from "./updates";

export {
  appendZonePic,
  deleteZone,
  deleteZonePic,
  setZoneDescription,
  upsertZone,
  type DeleteZoneResult,
} from "./zones";

export {
  addAnnotationTag,
  annotationHasContent,
  deleteAnnotation,
  readAnnotations,
  removeAnnotationTag,
  setAnnotationRemoved,
  upsertAnnotation,
} from "./annotations";

export {
  commitBatchState,
  loadBatchState,
  type BatchState,
  type DirtyFile,
} from "./batchState";

export { readAiAnalyses, readRollupRaw, writeAiAnalyses } from "./analyses";
