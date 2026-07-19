/**
 * Shared journal validation — the frontend counterpart to
 * `worker/src/validation.ts`. Kept byte-for-byte compatible so a garden edited
 * from the browser (Drive mode) and one edited from Telegram (GitHub mode)
 * enforce the same identifier rules.
 *
 * Rejects path-traversal payloads ("..", "/", "\"), control characters,
 * leading punctuation, and oversized inputs, since shortCode/zoneCode end up
 * as filename segments and JSON keys.
 */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export function isValidCode(s: string): boolean {
  return CODE_RE.test(s);
}

export function codeError(label: string, s: string): string | null {
  if (CODE_RE.test(s)) return null;
  return `Invalid ${label} "${s}" — must start with a letter or digit and contain only letters, digits, spaces, hyphens, and underscores (max 64 chars).`;
}

export function assertValidCode(label: string, s: string): void {
  const err = codeError(label, s);
  if (err) throw new Error(err);
}
