// Strict validation for user-supplied identifiers (shortCode, zoneCode) that
// end up as path segments in GitHub Contents API URLs and as keys in the
// committed JSON manifests. Rejects path-traversal payloads ("..", "/", "\"),
// control characters, leading punctuation, and oversized inputs.
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export function isValidCode(s: string): boolean {
  return CODE_RE.test(s);
}

export function assertValidCode(label: string, s: string): void {
  if (!CODE_RE.test(s)) {
    throw new Error(
      `Invalid ${label} "${s}" — must start with a letter or digit and contain only letters, digits, spaces, hyphens, and underscores (max 64 chars).`
    );
  }
}
