import { describe, it, expect } from "bun:test";
import { loadWithCache, type BundleCache, type CachedBundle } from "../data/driveCache";

/** In-memory BundleCache that records how it was exercised. */
function fakeCache(seed: Record<string, CachedBundle> = {}) {
  const store = new Map<string, CachedBundle>(Object.entries(seed));
  const calls = { get: 0, set: 0 };
  const cache: BundleCache = {
    async get(id) {
      calls.get++;
      return store.get(id) ?? null;
    },
    async set(id, entry) {
      calls.set++;
      store.set(id, entry);
    },
    async prune() {},
    async clear() {
      store.clear();
    },
  };
  return { cache, store, calls };
}

describe("loadWithCache", () => {
  it("serves the cached copy when modifiedTime matches (no download)", async () => {
    const { cache } = fakeCache({ f1: { modifiedTime: "t1", json: { v: "cached" } } });
    let downloaded = false;
    const out = await loadWithCache<{ v: string }>("f1", "t1", cache, async () => {
      downloaded = true;
      return { v: "fresh" };
    });
    expect(out.v).toBe("cached");
    expect(downloaded).toBe(false);
  });

  it("downloads and re-caches when modifiedTime differs", async () => {
    const { cache, store } = fakeCache({ f1: { modifiedTime: "old", json: { v: "stale" } } });
    const out = await loadWithCache<{ v: string }>("f1", "new", cache, async () => ({ v: "fresh" }));
    expect(out.v).toBe("fresh");
    expect(store.get("f1")).toEqual({ modifiedTime: "new", json: { v: "fresh" } });
  });

  it("downloads and caches on a cold miss", async () => {
    const { cache, store, calls } = fakeCache();
    const out = await loadWithCache<{ v: string }>("f1", "t1", cache, async () => ({ v: "fresh" }));
    expect(out.v).toBe("fresh");
    expect(store.get("f1")).toEqual({ modifiedTime: "t1", json: { v: "fresh" } });
    expect(calls.set).toBe(1);
  });

  it("never caches or reads when modifiedTime is missing", async () => {
    const { cache, calls } = fakeCache({ f1: { modifiedTime: "t1", json: { v: "cached" } } });
    let downloaded = false;
    const out = await loadWithCache<{ v: string }>("f1", undefined, cache, async () => {
      downloaded = true;
      return { v: "fresh" };
    });
    expect(out.v).toBe("fresh");
    expect(downloaded).toBe(true);
    expect(calls.get).toBe(0);
    expect(calls.set).toBe(0);
  });

  it("falls back to download when the cache read throws", async () => {
    const cache: BundleCache = {
      async get() {
        throw new Error("idb unavailable");
      },
      async set() {},
      async prune() {},
      async clear() {},
    };
    const out = await loadWithCache<{ v: string }>("f1", "t1", cache, async () => ({ v: "fresh" }));
    expect(out.v).toBe("fresh");
  });

  it("still returns the download when the cache write throws", async () => {
    const cache: BundleCache = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("quota exceeded");
      },
      async prune() {},
      async clear() {},
    };
    const out = await loadWithCache<{ v: string }>("f1", "t1", cache, async () => ({ v: "fresh" }));
    expect(out.v).toBe("fresh");
  });
});
