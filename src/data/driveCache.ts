/**
 * Persistent cache of Drive JSON bundles, keyed by Drive fileId, so a bundle
 * whose Drive `modifiedTime` hasn't changed since it was last fetched is served
 * from the browser instead of re-downloaded. The folder listing `initDrive`
 * already performs reports every data file's `modifiedTime`, so freshness is
 * validated with no extra requests — a reload with no changes downloads nothing,
 * and only bundles edited out of band (e.g. from another device) are refetched.
 *
 * Backed by IndexedDB (bundles like species/embeddings can be large). When
 * IndexedDB is unavailable — server prerender, tests, private-mode lockdowns —
 * every operation degrades to a no-op and loads simply fall through to Drive.
 */

export interface CachedBundle {
  modifiedTime: string;
  json: unknown;
}

export interface BundleCache {
  get(fileId: string): Promise<CachedBundle | null>;
  set(fileId: string, entry: CachedBundle): Promise<void>;
  /** Drop cached entries for fileIds no longer present (deleted/renamed files). */
  prune(keepFileIds: Iterable<string>): Promise<void>;
  /** Wipe the whole cache (used when the backing garden is deleted). */
  clear(): Promise<void>;
}

/**
 * Serve `fileId` from `cache` when the cached copy's `modifiedTime` matches the
 * one Drive currently reports; otherwise download via `download`, store the
 * result, and return it. A missing `modifiedTime` (the folder listing didn't
 * report one) always misses and is never cached, so a copy we can't prove
 * current is never served. Cache read/write failures fall back to the download.
 */
export async function loadWithCache<T>(
  fileId: string,
  modifiedTime: string | undefined,
  cache: BundleCache,
  download: (fileId: string) => Promise<T>,
): Promise<T> {
  if (modifiedTime) {
    const cached = await cache.get(fileId).catch(() => null);
    if (cached && cached.modifiedTime === modifiedTime) return cached.json as T;
  }
  const json = await download(fileId);
  if (modifiedTime) await cache.set(fileId, { modifiedTime, json }).catch(() => {});
  return json;
}

const DB_NAME = "plantyj-drive-cache";
const STORE = "bundles";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

/** Run one request against the object store; resolves null on any failure. */
function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** IndexedDB-backed cache used in the browser; a no-op wherever IDB is absent. */
export const indexedDbCache: BundleCache = {
  async get(fileId) {
    return (await tx<CachedBundle>("readonly", (s) => s.get(fileId))) ?? null;
  },
  async set(fileId, entry) {
    await tx("readwrite", (s) => s.put(entry, fileId));
  },
  async prune(keepFileIds) {
    const keep = new Set(keepFileIds);
    const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    if (!keys) return;
    for (const key of keys) {
      if (!keep.has(key as string)) await tx("readwrite", (s) => s.delete(key));
    }
  },
  async clear() {
    await tx("readwrite", (s) => s.clear());
  },
};
