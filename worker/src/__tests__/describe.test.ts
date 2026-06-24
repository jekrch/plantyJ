import { describe, it, expect } from "bun:test";
import { buildDescribePrompt } from "../identify";

const rollup = {
  zones: [
    { code: "fb1", name: "Front Bed 1" },
    { code: "sb" },
  ],
  plants: [{ shortCode: "tmt-c", commonName: "Cherokee Purple", fullName: "Solanum lycopersicum" }],
};

describe("buildDescribePrompt", () => {
  it("embeds the user's description and tells the model to trust it", () => {
    const p = buildDescribePrompt(rollup, "cherry tomato in fb1, tag edible", null);
    expect(p).toContain('"cherry tomato in fb1, tag edible"');
    expect(p).toContain("TRUST");
    expect(p).toContain("ONE"); // asks for a single canonical entry
  });

  it("lists the known zones and existing plants for code lookup", () => {
    const p = buildDescribePrompt(rollup, "some plant", null);
    expect(p).toContain("fb1 — Front Bed 1");
    expect(p).toContain("sb");
    expect(p).toContain("tmt-c");
  });

  it("frames a /resp turn as a correction and includes the prompt history", () => {
    const p = buildDescribePrompt(rollup, "actually it's in sb", ["cherry tomato in fb1"]);
    expect(p).toContain("correction");
    expect(p).toContain("initial /ask: cherry tomato in fb1");
    expect(p).toContain('"actually it\'s in sb"');
  });

  it("does not show a prior-session block on the first turn", () => {
    const p = buildDescribePrompt(rollup, "first turn", null);
    expect(p).not.toContain("Earlier in this session");
  });
});
