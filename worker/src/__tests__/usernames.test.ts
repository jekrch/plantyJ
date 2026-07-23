import { describe, it, expect } from "bun:test";
import {
  claimUsername,
  isValidUsername,
  lookupUsername,
  normalizeUsername,
  type UsernameRecord,
} from "../usernames";
import type { KVNamespace } from "../types";

/** In-memory stand-in for a KV namespace, adequate for the claim/lookup logic. */
function fakeKV(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const kv: KVNamespace = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  };
  return { kv, store };
}

const MANIFEST = "1PA_5pgWk-_enF-AsknqYxt7biqU9UweR";

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsername("  Alice ")).toBe("alice");
    expect(normalizeUsername("BoB-42")).toBe("bob-42");
  });
});

describe("isValidUsername", () => {
  it("accepts well-formed names", () => {
    expect(isValidUsername("alice")).toBe(true);
    expect(isValidUsername("bob-42")).toBe(true);
    expect(isValidUsername("a1")).toBe(true); // 2-char minimum
    expect(isValidUsername("a".repeat(30))).toBe(true); // 30-char maximum
  });

  it("rejects malformed names", () => {
    expect(isValidUsername("a")).toBe(false); // too short
    expect(isValidUsername("a".repeat(31))).toBe(false); // too long
    expect(isValidUsername("-alice")).toBe(false); // leading hyphen
    expect(isValidUsername("alice-")).toBe(false); // trailing hyphen
    expect(isValidUsername("Alice")).toBe(false); // uppercase (caller normalizes)
    expect(isValidUsername("al ice")).toBe(false); // space
    expect(isValidUsername("al.ice")).toBe(false); // punctuation
    expect(isValidUsername("../x")).toBe(false);
  });

  it("rejects reserved names", () => {
    expect(isValidUsername("public")).toBe(false);
    expect(isValidUsername("api")).toBe(false);
    expect(isValidUsername("plantyj")).toBe(false);
  });
});

describe("claimUsername", () => {
  it("claims a free name and makes it resolvable", async () => {
    const { kv } = fakeKV();
    const res = await claimUsername(kv, "alice", MANIFEST, "sub-1");
    expect(res.ok).toBe(true);
    const record = await lookupUsername(kv, "alice");
    expect(record).toEqual({ manifestId: MANIFEST, ownerSub: "sub-1" } as UsernameRecord);
  });

  it("lets the same owner re-point their name to a new manifest", async () => {
    const { kv } = fakeKV();
    await claimUsername(kv, "alice", MANIFEST, "sub-1");
    const other = "2QB_6qhXl-_foG-BtlorZyu8cjrV0VxfS";
    const res = await claimUsername(kv, "alice", other, "sub-1");
    expect(res.ok).toBe(true);
    expect((await lookupUsername(kv, "alice"))?.manifestId).toBe(other);
  });

  it("refuses a name another account already holds", async () => {
    const { kv } = fakeKV();
    await claimUsername(kv, "alice", MANIFEST, "sub-1");
    const res = await claimUsername(kv, "alice", MANIFEST, "sub-2");
    expect(res).toEqual({ ok: false, status: 409, message: "That name is already taken" });
    // The original owner's mapping is untouched.
    expect((await lookupUsername(kv, "alice"))?.ownerSub).toBe("sub-1");
  });

  it("releases the owner's previous name when they claim a new one", async () => {
    const { kv } = fakeKV();
    await claimUsername(kv, "alice", MANIFEST, "sub-1");
    await claimUsername(kv, "alice2", MANIFEST, "sub-1");
    expect(await lookupUsername(kv, "alice")).toBeNull(); // old name freed
    expect((await lookupUsername(kv, "alice2"))?.ownerSub).toBe("sub-1");
    // ...so someone else can now take the freed name.
    const res = await claimUsername(kv, "alice", MANIFEST, "sub-9");
    expect(res.ok).toBe(true);
  });

  it("rejects an invalid username or manifest id before writing", async () => {
    const { kv, store } = fakeKV();
    expect((await claimUsername(kv, "-bad", MANIFEST, "sub-1")).ok).toBe(false);
    expect((await claimUsername(kv, "alice", "short", "sub-1")).ok).toBe(false);
    expect(store.size).toBe(0);
  });
});
