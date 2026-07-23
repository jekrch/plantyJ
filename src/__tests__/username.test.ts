import { describe, it, expect } from "bun:test";
import { isValidUsername, normalizeUsername } from "../data/username";

// The frontend keeps its own copy of the validation rules (to explain a bad name
// before a round trip); these assertions mirror worker/src/__tests__/usernames.test.ts
// so the two copies can't silently drift apart.
describe("username validation (frontend copy)", () => {
  it("normalizes to trimmed lowercase", () => {
    expect(normalizeUsername("  Alice ")).toBe("alice");
  });

  it("accepts well-formed names", () => {
    for (const ok of ["alice", "bob-42", "a1", "a".repeat(30)]) {
      expect(isValidUsername(ok)).toBe(true);
    }
  });

  it("rejects malformed and reserved names", () => {
    for (const bad of [
      "a",
      "a".repeat(31),
      "-alice",
      "alice-",
      "Alice",
      "al ice",
      "al.ice",
      "public",
      "plantyj",
    ]) {
      expect(isValidUsername(bad)).toBe(false);
    }
  });
});
