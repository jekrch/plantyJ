import { describe, it, expect } from "bun:test";
import {
  buildRelationshipPrompt,
  parseRelationshipCommands,
  type GardenRollup,
} from "../data/relationshipAI";

const emptyRollup: GardenRollup = {
  generatedAt: "2026-07-19",
  zones: [],
  plants: [
    { shortCode: "tomato", commonName: "Tomato", pics: [], picCount: 0, zonesSeen: [] },
    { shortCode: "basil", commonName: "Basil", pics: [], picCount: 0, zonesSeen: [] },
  ],
  orphanPics: [],
  relationships: { types: [], edges: [] },
};

describe("parseRelationshipCommands", () => {
  it("parses /relate with an explicit direction", () => {
    const { commands, errors } = parseRelationshipCommands(
      "/relate pollinates // honeybee // borage // f",
    );
    expect(errors).toHaveLength(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      kind: "relate",
      typeId: "pollinates",
      from: "honeybee",
      to: "borage",
      direction: "f",
      raw: "/relate pollinates // honeybee // borage // f",
    });
  });

  it("parses /reltype and treats a missing 4th field as undirected", () => {
    const { commands } = parseRelationshipCommands("/reltype companion // Companion // grows well with");
    expect(commands[0]).toMatchObject({
      kind: "reltype",
      id: "companion",
      name: "Companion",
      description: "grows well with",
      directional: false,
    });
  });

  it("omits direction when the token is absent or junk", () => {
    const { commands } = parseRelationshipCommands("/relate companion // tomato // basil");
    expect(commands[0]).toMatchObject({ kind: "relate", direction: undefined });
  });

  it("strips code fences and list markers, ignores prose", () => {
    const reply = [
      "Here are my suggestions:",
      "```",
      "1. /relate companion // tomato // basil // u",
      "- /reltype pollinates // Pollinates // bug visits flower // directional",
      "```",
      "Let me know if you want more.",
    ].join("\n");
    const { commands, errors } = parseRelationshipCommands(reply);
    expect(errors).toHaveLength(0);
    expect(commands.map((c) => c.kind)).toEqual(["relate", "reltype"]);
  });

  it("flags malformed slash-commands as errors but keeps good ones", () => {
    const { commands, errors } = parseRelationshipCommands(
      "/relate onlytwo // fields\n/relate companion // tomato // basil // u",
    );
    expect(commands).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("normalises verbose direction words", () => {
    const { commands } = parseRelationshipCommands(
      "/relate eats // fox // rabbit // backward",
    );
    expect(commands[0]).toMatchObject({ direction: "b" });
  });
});

describe("buildRelationshipPrompt", () => {
  it("embeds the rollup JSON and the command grammar", () => {
    const prompt = buildRelationshipPrompt(emptyRollup);
    expect(prompt).toContain(JSON.stringify(emptyRollup));
    expect(prompt).toContain("/relate <typeId> // <fromCode> // <toCode>");
    expect(prompt).toContain("/reltype <id> // <name> // <description>");
    // The organism codes the model must copy verbatim are present.
    expect(prompt).toContain("tomato");
    expect(prompt).toContain("basil");
  });
});
