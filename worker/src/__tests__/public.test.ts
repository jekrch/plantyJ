import { describe, it, expect } from "bun:test";
import { allowedIds, isDriveId } from "../public";

describe("isDriveId", () => {
  it("accepts Drive-shaped ids and rejects junk", () => {
    expect(isDriveId("1PA_5pgWk-_enF-AsknqYxt7biqU9UweR")).toBe(true);
    expect(isDriveId("abcABC0123456789")).toBe(true);
    expect(isDriveId("short")).toBe(false); // under 10 chars
    expect(isDriveId("../../etc/passwd")).toBe(false);
    expect(isDriveId("has space here")).toBe(false);
    expect(isDriveId("")).toBe(false);
    expect(isDriveId(null)).toBe(false);
    expect(isDriveId(undefined)).toBe(false);
  });
});

describe("allowedIds", () => {
  it("collects bundle, full-image, and thumbnail ids the manifest references", () => {
    const set = allowedIds({
      data: { "pics.json": "PICS", "plants.json": "PLANTS" },
      images: {
        "full-a": { thumb: "thumb-a" },
        "full-b": { thumb: null },
      },
    });
    expect([...set].sort()).toEqual(["PICS", "PLANTS", "full-a", "full-b", "thumb-a"].sort());
  });

  it("is empty for a manifest with no data or images", () => {
    expect(allowedIds({}).size).toBe(0);
  });

  it("does not admit an unreferenced id (the open-proxy guard)", () => {
    const set = allowedIds({ data: { "pics.json": "PICS" }, images: {} });
    expect(set.has("PICS")).toBe(true);
    expect(set.has("some-other-public-file")).toBe(false);
  });
});
