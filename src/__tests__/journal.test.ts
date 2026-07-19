import { describe, it, expect } from "bun:test";
import { isValidCode, codeError, assertValidCode } from "../lib/journal/validation";
import { createZip } from "../utils/zip";

describe("journal validation", () => {
  it("accepts well-formed codes", () => {
    for (const code of ["tmt-c", "fb1", "Zone_2", "a", "A B C"]) {
      expect(isValidCode(code)).toBe(true);
      expect(codeError("code", code)).toBeNull();
    }
  });

  it("rejects traversal, control chars, leading punctuation, and overlong input", () => {
    for (const code of ["../etc", "/abs", "a\\b", "-lead", " lead", "a/b", "a".repeat(65), ""]) {
      expect(isValidCode(code)).toBe(false);
    }
  });

  it("assertValidCode throws with the label", () => {
    expect(() => assertValidCode("zone code", "../x")).toThrow(/zone code/);
    expect(() => assertValidCode("plant code", "ok-1")).not.toThrow();
  });
});

describe("createZip (store)", () => {
  it("produces a valid archive with the right signatures and entry count", () => {
    const enc = new TextEncoder();
    const zip = createZip([
      { name: "PlantyJ/data/pics.json", data: enc.encode('{"pics":[]}') },
      { name: "PlantyJ/images/a.jpg", data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    expect(zip.type).toBe("application/zip");
  });

  it("round-trips file content and central-directory metadata", async () => {
    const enc = new TextEncoder();
    const payload = enc.encode("hello zip");
    const zip = createZip([{ name: "x.txt", data: payload }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);

    // Local file header signature at offset 0.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    // End-of-central-directory record reports exactly one entry.
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(1);

    // Stored (method 0) content follows the 30-byte header + name.
    const nameLen = view.getUint16(26, true);
    const stored = bytes.slice(30 + nameLen, 30 + nameLen + payload.length);
    expect(new TextDecoder().decode(stored)).toBe("hello zip");
  });
});
