import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type Loader<T extends ComponentType<any>> = () => Promise<{ default: T }>;

export type Preloadable<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /** Start fetching the chunk without rendering it. Safe to call repeatedly. */
  preload: () => void;
};

/**
 * `React.lazy` with a handle to start the fetch early.
 *
 * Splitting a component out means the first render that needs it pays a network
 * round trip, which is the wrong trade for things the visitor almost certainly
 * opens (the photo viewer, the about modal). `preload()` lets the app warm those
 * chunks once the page is idle, so the split costs startup time without costing
 * interaction time.
 *
 * A failed load clears the cached promise: React.lazy latches onto whatever it
 * is first given, so keeping a rejected one would make the component
 * permanently broken after a single flaky fetch.
 */
export function lazyWithPreload<T extends ComponentType<any>>(loader: Loader<T>): Preloadable<T> {
  let pending: Promise<{ default: T }> | null = null;

  const load = () => {
    if (!pending) {
      pending = loader().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };

  const Component = lazy(load) as Preloadable<T>;
  Component.preload = () => {
    // Nothing to do on failure — the next render retries via `load`.
    void load().catch(() => {});
  };
  return Component;
}

/**
 * Warm chunks when the browser has nothing better to do. Skipped entirely when
 * the visitor has asked for reduced data usage.
 */
export function preloadWhenIdle(components: Preloadable<any>[], timeout = 3000): () => void {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};

  const run = () => components.forEach((c) => c.preload());

  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, timeout);
  return () => clearTimeout(id);
}
