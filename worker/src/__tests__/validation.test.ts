import { describe, it, expect } from "bun:test";
import { isValidCode, assertValidCode } from "../validation";

describe("isValidCode", () => {
  it("accepts simple alphanumeric codes", () => {
    expect(isValidCode("fb1")).toBe(true);
    expect(isValidCode("A")).toBe(true);
    expect(isValidCode("9")).toBe(true);
    expect(isValidCode("T ser")).toBe(true);
    expect(isValidCode("V sor pri")).toBe(true);
  });

  it("accepts hyphens and underscores after the first char", () => {
    expect(isValidCode("tmt-c")).toBe(true);
    expect(isValidCode("a_b")).toBe(true);
    expect(isValidCode("unid-42")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidCode("")).toBe(false);
  });

  it("rejects leading punctuation", () => {
    expect(isValidCode("-foo")).toBe(false);
    expect(isValidCode("_foo")).toBe(false);
    expect(isValidCode(" foo")).toBe(false);
  });

  it("rejects path-traversal payloads", () => {
    expect(isValidCode("..")).toBe(false);
    expect(isValidCode("../bar")).toBe(false);
    expect(isValidCode("foo/bar")).toBe(false);
    expect(isValidCode("foo\\bar")).toBe(false);
  });

  it("rejects control characters and disallowed punctuation", () => {
    expect(isValidCode("foo\nbar")).toBe(false);
    expect(isValidCode("foo\tbar")).toBe(false);
    expect(isValidCode("foo.bar")).toBe(false);
    expect(isValidCode("foo:bar")).toBe(false);
    expect(isValidCode("foo+bar")).toBe(false);
  });

  it("accepts exactly 64 chars and rejects 65", () => {
    const head = "A";
    expect(isValidCode(head + "a".repeat(63))).toBe(true);
    expect(isValidCode(head + "a".repeat(64))).toBe(false);
  });
});

describe("assertValidCode", () => {
  it("does not throw for valid codes", () => {
    expect(() => assertValidCode("shortCode", "tmt-c")).not.toThrow();
  });

  it("throws with the label and the offending value", () => {
    expect(() => assertValidCode("zoneCode", "../etc")).toThrow(/zoneCode/);
    expect(() => assertValidCode("zoneCode", "../etc")).toThrow(/"\.\.\/etc"/);
  });
});
