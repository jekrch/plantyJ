import { describe, it, expect } from "bun:test";
import {
  buildManifest,
  INTERNAL_DATA_FILES,
  MANIFEST_FILE,
  MANIFEST_VERSION,
} from "../data/publicManifest";

const AT = "2026-07-20T00:00:00.000Z";

describe("buildManifest", () => {
  it("maps every data bundle except the app-internal ones", () => {
    const m = buildManifest({
      dataFiles: new Map([
        ["pics.json", "P"],
        ["plants.json", "L"],
        [MANIFEST_FILE, "SELF"],
        ["thumbnails.json", "T"],
      ]),
      imageIds: [],
      thumbs: new Map(),
      publishedAt: AT,
    });
    expect(m.version).toBe(MANIFEST_VERSION);
    expect(m.publishedAt).toBe(AT);
    expect(m.data).toEqual({ "pics.json": "P", "plants.json": "L" });
    // The internal files that must never leak into the reader's bundle list.
    for (const name of INTERNAL_DATA_FILES) expect(m.data[name]).toBeUndefined();
  });

  it("pairs each full image with its thumbnail, or null when it has none", () => {
    const m = buildManifest({
      dataFiles: new Map(),
      imageIds: ["full-a", "full-b"],
      thumbs: new Map([["full-a", "thumb-a"]]),
      publishedAt: AT,
    });
    expect(m.images).toEqual({
      "full-a": { thumb: "thumb-a" },
      "full-b": { thumb: null },
    });
  });

  it("excludes thumbnail files from images so they're never served as full images", () => {
    // The images folder lists both full uploads and their thumbnails; the
    // thumbnail file IDs (map values) must not appear as their own keys.
    const m = buildManifest({
      dataFiles: new Map(),
      imageIds: ["full-a", "thumb-a"],
      thumbs: new Map([["full-a", "thumb-a"]]),
      publishedAt: AT,
    });
    expect(Object.keys(m.images)).toEqual(["full-a"]);
    expect(m.images["thumb-a"]).toBeUndefined();
  });
});
