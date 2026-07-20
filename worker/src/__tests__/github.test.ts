import { describe, it, expect } from "bun:test";
import {
  arrayBufferToBase64,
  base64ToBytes,
  base64ToUtf8,
  bytesToBase64,
  utf8ToBase64,
} from "../github/encoding";
import { isPicField, isUpdatableField, parseList, UPDATABLE_FIELD_LIST } from "../github/fields";
import { applyZoneUpserts, nextSeq, upsertPlantRecord } from "../github/gallery";
import type { Gallery, PicEntry, PlantRecord, Zone } from "../types";

function pic(seq: number, overrides: Partial<PicEntry> = {}): PicEntry {
  return {
    seq,
    id: `p${seq}`,
    shortCode: "tmt-c",
    zoneCode: "fb1",
    tags: [],
    description: null,
    image: `images/tmt-c/${seq}.jpg`,
    postedBy: "jacob",
    addedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

function gallery(pics: PicEntry[]): Gallery {
  return { pics, plants: [], zones: [], zonePics: [] };
}

function plant(shortCode: string, overrides: Partial<PlantRecord> = {}): PlantRecord {
  return { shortCode, fullName: null, commonName: null, ...overrides };
}

describe("encoding", () => {
  it("round-trips plain ASCII", () => {
    expect(base64ToUtf8(utf8ToBase64("hello world"))).toBe("hello world");
  });

  // btoa is Latin-1 only, so these used to throw InvalidCharacterError.
  it("round-trips non-ASCII text that btoa alone cannot encode", () => {
    for (const text of [
      "Solanum lycopersicum 'Cherokee Purple' — heirloom",
      "Café mûre, naïve résumé",
      "smart “quotes” and ellipsis…",
      "日本語のテキスト",
      "emoji 🌱🍅",
    ]) {
      expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
    }
  });

  it("produces base64 that decodes to valid UTF-8 bytes", () => {
    const b64 = utf8ToBase64("é");
    // U+00E9 is two bytes in UTF-8 (0xC3 0xA9), not one Latin-1 byte.
    expect(Array.from(base64ToBytes(b64))).toEqual([0xc3, 0xa9]);
  });

  it("round-trips an empty string", () => {
    expect(base64ToUtf8(utf8ToBase64(""))).toBe("");
  });

  it("round-trips a JSON manifest with accented species names", () => {
    const body = JSON.stringify({ plants: [{ fullName: "Ærva lanata — cultivar 'Æther'" }] });
    expect(JSON.parse(base64ToUtf8(utf8ToBase64(body)))).toEqual(JSON.parse(body));
  });

  // The chunked loop in bytesToBase64 exists to keep String.fromCharCode from
  // blowing the call stack; anything over CHUNK (0x8000) exercises it.
  it("encodes payloads larger than one chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 1234);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("encodes an ArrayBuffer (the image upload path)", () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    expect(base64ToBytes(arrayBufferToBase64(buf))).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });

  it("encodes empty binary without error", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });
});

describe("parseList", () => {
  it("splits on commas and trims", () => {
    expect(parseList("edible, heirloom ,native")).toEqual(["edible", "heirloom", "native"]);
  });

  it("drops empty segments from trailing or doubled commas", () => {
    expect(parseList("edible,,heirloom,")).toEqual(["edible", "heirloom"]);
  });

  it("returns nothing for blank input", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
    expect(parseList(",,,")).toEqual([]);
  });

  it("keeps a single unsplit value", () => {
    expect(parseList("heirloom")).toEqual(["heirloom"]);
  });
});

describe("updatable fields", () => {
  it("accepts every advertised field", () => {
    for (const f of UPDATABLE_FIELD_LIST) expect(isUpdatableField(f)).toBe(true);
  });

  it("rejects unknown fields and near-misses", () => {
    for (const f of ["seq", "image", "zonecode", "ZoneCode", "", "__proto__"]) {
      expect(isUpdatableField(f)).toBe(false);
    }
  });

  it("routes pic-level fields to the pic and the rest to the plant", () => {
    expect(isPicField("zoneCode")).toBe(true);
    expect(isPicField("tags")).toBe(true);
    expect(isPicField("description")).toBe(true);
    expect(isPicField("shortCode")).toBe(false);
    expect(isPicField("fullName")).toBe(false);
    expect(isPicField("commonName")).toBe(false);
    expect(isPicField("variety")).toBe(false);
  });
});

describe("nextSeq", () => {
  it("starts at 1 on an empty gallery", () => {
    expect(nextSeq(gallery([]))).toBe(1);
  });

  it("takes the max, not the count or the last entry", () => {
    expect(nextSeq(gallery([pic(7), pic(2), pic(5)]))).toBe(8);
  });

  it("ignores entries with a missing or zero seq", () => {
    const pics = [pic(0), { ...pic(3), seq: undefined as unknown as number }, pic(4)];
    expect(nextSeq(gallery(pics))).toBe(5);
  });

  it("never reuses a seq after the highest pic is deleted", () => {
    // Deleting #5 from [3,5] leaves [3]; the next seq must still clear 3.
    expect(nextSeq(gallery([pic(3)]))).toBe(4);
  });
});

describe("applyZoneUpserts", () => {
  const zones: Zone[] = [
    { code: "fb1", name: "Front Bed 1" },
    { code: "mp", name: null },
  ];

  it("appends zones that don't exist yet", () => {
    const next = applyZoneUpserts(zones, [{ code: "bb", name: "Back Bed" }]);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ code: "bb", name: "Back Bed" });
  });

  it("fills in a name that was previously null", () => {
    const next = applyZoneUpserts(zones, [{ code: "mp", name: "Maple" }]);
    expect(next.find((z) => z.code === "mp")!.name).toBe("Maple");
  });

  it("never blanks an existing name with a null upsert", () => {
    const next = applyZoneUpserts(zones, [{ code: "fb1", name: null }]);
    expect(next.find((z) => z.code === "fb1")!.name).toBe("Front Bed 1");
  });

  it("renames when the upsert carries a new name", () => {
    const next = applyZoneUpserts(zones, [{ code: "fb1", name: "Front Bed One" }]);
    expect(next.find((z) => z.code === "fb1")!.name).toBe("Front Bed One");
  });

  it("does not mutate the input array", () => {
    const before = JSON.parse(JSON.stringify(zones));
    applyZoneUpserts(zones, [{ code: "bb", name: "Back Bed" }, { code: "fb1", name: "Renamed" }]);
    expect(zones).toEqual(before);
  });

  it("applies several upserts in one pass", () => {
    const next = applyZoneUpserts(zones, [
      { code: "bb", name: "Back Bed" },
      { code: "mp", name: "Maple" },
    ]);
    expect(next.map((z) => z.code)).toEqual(["fb1", "mp", "bb"]);
    expect(next.find((z) => z.code === "mp")!.name).toBe("Maple");
  });

  it("is a no-op for an empty upsert list", () => {
    expect(applyZoneUpserts(zones, [])).toEqual(zones);
  });
});

describe("upsertPlantRecord", () => {
  const plants: PlantRecord[] = [plant("tmt-c"), plant("bas")];

  it("puts a new plant at the front so it reads newest-first", () => {
    const next = upsertPlantRecord(plants, plant("mnt"));
    expect(next.map((p) => p.shortCode)).toEqual(["mnt", "tmt-c", "bas"]);
  });

  it("replaces an existing plant in place, keeping its position", () => {
    const next = upsertPlantRecord(plants, plant("bas", { commonName: "Basil" }));
    expect(next.map((p) => p.shortCode)).toEqual(["tmt-c", "bas"]);
    expect(next[1].commonName).toBe("Basil");
  });

  it("replaces wholesale rather than merging fields", () => {
    const withName = [plant("bas", { fullName: "Ocimum basilicum", commonName: "Basil" })];
    const next = upsertPlantRecord(withName, plant("bas"));
    expect(next[0].fullName).toBeNull();
    expect(next[0].commonName).toBeNull();
  });

  it("does not mutate the input array", () => {
    const before = JSON.parse(JSON.stringify(plants));
    upsertPlantRecord(plants, plant("bas", { commonName: "Basil" }));
    expect(plants).toEqual(before);
  });

  it("seeds an empty list", () => {
    expect(upsertPlantRecord([], plant("tmt-c"))).toEqual([plant("tmt-c")]);
  });
});
