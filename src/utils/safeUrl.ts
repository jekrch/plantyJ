/**
 * Sanitize a URL that came from garden data before it becomes an `href`.
 *
 * In a `?public=` share the JSON bundles are authored by whoever created the
 * link, not by the viewer, so a `references[].url` is untrusted input. A
 * `javascript:` (or `data:`/`vbscript:`) URL rendered into an anchor would run
 * in the plantyj.com origin on click — where the Drive OAuth token lives. The
 * CSP `script-src` already blocks `javascript:` navigation, but that mitigation
 * rests entirely on a `<meta>` CSP (browser gaps, no header fallback), so this
 * is the belt to that suspenders: only web-navigable schemes pass; anything
 * else collapses to `undefined` (render no href rather than a live one).
 */

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  // Protocol-relative ("//host") and root-relative ("/path") URLs carry no
  // dangerous scheme, so they're fine; parse only when a scheme is present.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      if (!SAFE_SCHEMES.has(new URL(trimmed).protocol)) return undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed;
}
