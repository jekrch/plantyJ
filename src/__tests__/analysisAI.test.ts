import { describe, it, expect } from "bun:test";
import {
  buildAnalysisPrompt,
  findMissingAnalysisPairs,
  pairKey,
  parseAnalysisResponse,
} from "../data/analysisAI";
import type { GardenRollup } from "../data/relationshipAI";
import type { AIAnalysis } from "../types";

const rollup: GardenRollup = {
  generatedAt: "2026-07-19",
  zones: [
    { code: "A", name: "Back bed", description: "Full sun, clay." },
    { code: "B", name: "Shade strip" },
  ],
  plants: [
    { shortCode: "tomato", commonName: "Tomato", pics: [], picCount: 0, zonesSeen: ["A", "B"] },
    { shortCode: "borage", commonName: "Borage", pics: [], picCount: 0, zonesSeen: ["A"] },
  ],
  orphanPics: [],
  relationships: { types: [], edges: [] },
};

describe("findMissingAnalysisPairs", () => {
  it("returns every specimen+zone pair when none are analyzed", () => {
    const pairs = findMissingAnalysisPairs(rollup, []);
    expect(pairs.map((p) => pairKey(p.shortCode, p.zoneCode))).toEqual([
      "borage|A",
      "tomato|A",
      "tomato|B",
    ]);
  });

  it("excludes pairs that already have an analysis", () => {
    const existing: AIAnalysis[] = [
      { shortCode: "tomato", zoneCode: "A", verdict: "GOOD", analysis: "x", references: [], created: "2026-01-01" },
    ];
    const pairs = findMissingAnalysisPairs(rollup, existing);
    expect(pairs.map((p) => pairKey(p.shortCode, p.zoneCode))).toEqual(["borage|A", "tomato|B"]);
  });
});

describe("buildAnalysisPrompt", () => {
  it("embeds the garden description, the exact pairs, the length, and the rollup JSON", () => {
    const prompt = buildAnalysisPrompt(rollup, {
      pairs: [
        { shortCode: "borage", zoneCode: "A" },
        { shortCode: "tomato", zoneCode: "B" },
      ],
      paragraphs: 2,
      gardenDescription: "Minneapolis, MN — zone 4b, clay/loam.",
    });
    expect(prompt).toContain("Minneapolis, MN — zone 4b, clay/loam.");
    expect(prompt).toContain("- borage // A");
    expect(prompt).toContain("- tomato // B");
    expect(prompt).toContain("exactly these 2 specimen+zone pair(s)");
    expect(prompt).toContain("2 paragraphs");
    expect(prompt).toContain(JSON.stringify(rollup));
  });

  it("falls back to a neutral property note when no description is saved", () => {
    const prompt = buildAnalysisPrompt(rollup, {
      pairs: [{ shortCode: "borage", zoneCode: "A" }],
      paragraphs: 1,
      gardenDescription: null,
    });
    expect(prompt).toContain("hasn't described their site");
    expect(prompt).toContain("1 paragraph");
  });
});

describe("parseAnalysisResponse", () => {
  const allowed = new Set(["borage|A", "tomato|B"]);

  it("parses a fenced JSON array into AIAnalysis records", () => {
    const reply = [
      "Here you go:",
      "```json",
      '[{ "shortCode": "borage", "zoneCode": "A", "verdict": "good", "analysis": "Great nectar source.", "references": ["https://en.wikipedia.org/wiki/Borage"] }]',
      "```",
    ].join("\n");
    const { analyses, errors } = parseAnalysisResponse(reply, allowed);
    expect(errors).toHaveLength(0);
    expect(analyses).toHaveLength(1);
    expect(analyses[0]).toMatchObject({
      shortCode: "borage",
      zoneCode: "A",
      verdict: "GOOD",
      analysis: "Great nectar source.",
      references: ["https://en.wikipedia.org/wiki/Borage"],
      created: "",
    });
  });

  it("strips a leading verdict word and inline citation markers", () => {
    const reply =
      '[{ "shortCode": "borage", "zoneCode": "A", "verdict": "MIXED", "analysis": "GOOD. Draws bees [1] but spreads [2, 3].", "references": [] }]';
    const { analyses } = parseAnalysisResponse(reply, allowed);
    expect(analyses[0].analysis).toBe("Draws bees but spreads.");
    expect(analyses[0].verdict).toBe("MIXED");
  });

  it("flags a bad verdict and drops junk references", () => {
    const reply =
      '[{ "shortCode": "borage", "zoneCode": "A", "verdict": "meh", "analysis": "text", "references": ["not-a-url", 5] }]';
    const { analyses, errors } = parseAnalysisResponse(reply, allowed);
    expect(analyses).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("drops pairs not in the requested set", () => {
    const reply =
      '[{ "shortCode": "tomato", "zoneCode": "A", "verdict": "GOOD", "analysis": "text", "references": [] }]';
    const { analyses, errors } = parseAnalysisResponse(reply, allowed);
    expect(analyses).toHaveLength(0);
    expect(errors[0].error).toContain("Unrequested pair");
  });

  it("skips duplicate pairs, keeping the first", () => {
    const reply = JSON.stringify([
      { shortCode: "borage", zoneCode: "A", verdict: "GOOD", analysis: "first", references: [] },
      { shortCode: "borage", zoneCode: "A", verdict: "BAD", analysis: "second", references: [] },
    ]);
    const { analyses, errors } = parseAnalysisResponse(reply, allowed);
    expect(analyses).toHaveLength(1);
    expect(analyses[0].analysis).toBe("first");
    expect(errors).toHaveLength(1);
  });
});
