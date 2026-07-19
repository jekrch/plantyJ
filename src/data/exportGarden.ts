import { collectGardenFiles } from "./driveSource";
import { createZip, type ZipEntry } from "../utils/zip";

/**
 * "Download my garden as .zip" (Phase 3.5) — bundle the user's entire Drive
 * garden (JSON bundles + images) into a single archive so they are never
 * locked in. Runs fully client-side against their own Drive.
 */
export async function exportGarden(
  onProgress?: (label: string, done: number, total: number) => void,
): Promise<void> {
  const files = await collectGardenFiles((done, total) =>
    onProgress?.("Downloading", done, total),
  );
  const zipEntries: ZipEntry[] = await Promise.all(
    files.map(async (f) => ({ name: f.path, data: new Uint8Array(await f.blob.arrayBuffer()) })),
  );
  onProgress?.("Packaging", files.length, files.length);
  const zip = createZip(zipEntries);

  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plantyj-garden-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
