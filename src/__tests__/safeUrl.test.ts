import { describe, it, expect } from "bun:test";
import { safeHref } from "../utils/safeUrl";

describe("safeHref", () => {
  it("passes through http/https/mailto", () => {
    expect(safeHref("https://gbif.org/species/1")).toBe("https://gbif.org/species/1");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:me@example.com")).toBe("mailto:me@example.com");
  });

  it("allows scheme-less relative and protocol-relative URLs", () => {
    expect(safeHref("/local/path")).toBe("/local/path");
    expect(safeHref("//cdn.example.com/x")).toBe("//cdn.example.com/x");
  });

  it("rejects javascript: and other script-bearing schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    // Whitespace/case tricks that would otherwise slip a scheme past a naive check.
    expect(safeHref("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  it("returns undefined for empty/nullish input", () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});
