import { describe, it, expect } from "bun:test";
import { isUnidentified, organismTitle } from "../utils/display";
import { organism } from "./helpers";

describe("isUnidentified", () => {
  it("returns true when shortCode starts with unid- and no names", () => {
    expect(isUnidentified({ shortCode: "unid-abc", fullName: null, commonName: null })).toBe(true);
  });

  it("returns false when shortCode does not start with unid-", () => {
    expect(isUnidentified({ shortCode: "rosa", fullName: null, commonName: null })).toBe(false);
  });

  it("returns false when unid- prefix but fullName is set", () => {
    expect(isUnidentified({ shortCode: "unid-1", fullName: "Rosa sp.", commonName: null })).toBe(false);
  });

  it("returns false when unid- prefix but commonName is set", () => {
    expect(isUnidentified({ shortCode: "unid-1", fullName: null, commonName: "Wild thing" })).toBe(false);
  });
});

describe("organismTitle", () => {
  it("prefers commonName over fullName", () => {
    expect(organismTitle(organism({ commonName: "Wild Rose", fullName: "Rosa canina" }))).toBe("Wild Rose");
  });

  it("falls back to fullName when no commonName", () => {
    expect(organismTitle(organism({ fullName: "Rosa canina", commonName: null }))).toBe("Rosa canina");
  });

  it("returns 'Unidentified' for unid- plants with no names", () => {
    expect(organismTitle(organism({ shortCode: "unid-1", fullName: null, commonName: null }))).toBe("Unidentified");
  });

  it("returns shortCode as last fallback", () => {
    expect(organismTitle(organism({ shortCode: "rosa-c", fullName: null, commonName: null }))).toBe("rosa-c");
  });

  it("appends variety in single quotes to commonName", () => {
    expect(organismTitle(organism({ commonName: "Apple", variety: "Honeycrisp" }))).toBe("Apple 'Honeycrisp'");
  });

  it("appends variety to fullName fallback", () => {
    expect(organismTitle(organism({ fullName: "Malus domestica", commonName: null, variety: "Gala" }))).toBe(
      "Malus domestica 'Gala'"
    );
  });

  it("does not append variety when it is null", () => {
    expect(organismTitle(organism({ commonName: "Apple", variety: null }))).toBe("Apple");
  });
});
