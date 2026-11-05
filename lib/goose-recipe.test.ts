// @vitest-environment node
// What a Goose turn is started with: the provider and model Goose is given, the instructions it runs
// under, the argv, and the recipe written beside the turn. Pure: the project's own instructions and
// skills are faked, so each shape (with and without) is reachable.
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  weft: "WEFT PROMPT",
  project: "",
  skills: "",
  // Whether Goose reads the folder's instructions on its own (it does when the folder has an AGENTS.md).
  gooseReads: false,
}));

vi.mock("./weft-prompts", () => ({ weftSystemPrompt: () => deps.weft }));
vi.mock("./puku-context", () => ({
  codexProjectInstructions: () => deps.project,
  gooseReadsProjectInstructions: () => deps.gooseReads,
}));
vi.mock("./skills", () => ({
  skillIndex: () => deps.skills,
  skillInvocation: (text: string) => text,
}));

const {
  gooseArgs,
  gooseModelFor,
  goosePrompt,
  gooseProviderFor,
  gooseRecipeYaml,
  gooseSystemText,
  yamlString,
  GOOSE_MAX_TURNS,
} = await import("./goose-recipe");

const plan = (over: Partial<import("./goose-recipe").GooseTurnPlan> = {}) => ({
  cwd: "/repo",
  backend: "goose" as const,
  ...over,
});

beforeEach(() => {
  deps.weft = "WEFT PROMPT";
  deps.project = "";
  deps.skills = "";
  deps.gooseReads = false;
});

describe("the provider and model Goose is given", () => {
  it("is the card's own, trimmed", () => {
    expect(gooseProviderFor(plan({ provider: " anthropic " }))).toBe("anthropic");
    expect(gooseModelFor(plan({ model: " openai/gpt-4.1 " }))).toBe("openai/gpt-4.1");
  });

  it("is nothing when the card names none", () => {
    expect(gooseProviderFor(plan())).toBe("");
    expect(gooseProviderFor(plan({ provider: "   " }))).toBe("");
    expect(gooseModelFor(plan())).toBe("");
    expect(gooseModelFor(plan({ model: "  " }))).toBe("");
  });

  it("is nothing on Goose's own 'let the CLI decide' sentinel", () => {
    expect(gooseModelFor(plan({ model: "goose-default" }))).toBe("");
  });
});

describe("the instructions a turn runs under", () => {
  it("holds Weft's prompt, the project's own instructions and the skills", () => {
    deps.project = "PROJECT RULES";
    deps.skills = "# Skills\n- one";
    const text = gooseSystemText(plan());
    expect(text).toContain("WEFT PROMPT");
    expect(text).toContain("# Project instructions\nPROJECT RULES");
    expect(text).toContain("# Skills");
  });

  it("leaves out what isn't there", () => {
    deps.weft = "";
    deps.project = "";
    deps.skills = "";
    // The copilot is the one turn with no attribution line, so it is the one with nothing at all.
    expect(gooseSystemText(plan({ copilot: true }))).toBe("");
  });

  it("sends the project's instructions itself only when Goose can't read them", () => {
    deps.project = "PROJECT RULES";
    // No AGENTS.md in the folder: Goose reads no CLAUDE.md of its own, so Weft sends them.
    deps.gooseReads = false;
    expect(gooseSystemText(plan())).toContain("# Project instructions\nPROJECT RULES");
    // An AGENTS.md is there: Goose loads it, and the `@./path` imports in it, so sending them again
    // would put the same instructions in the prompt twice.
    deps.gooseReads = true;
    expect(gooseSystemText(plan())).not.toContain("PROJECT RULES");
  });

  it("tells the copilot how to sign its commits, and the copilot doesn't commit", () => {
    expect(gooseSystemText(plan({ copilot: true }))).not.toContain("Co-Authored-By");
    expect(gooseSystemText(plan())).toContain("Co-Authored-By");
  });
});

describe("the turn's prompt", () => {
  it("is the user's text, as the skill module hands it over", () => {
    expect(goosePrompt(plan(), "do it")).toBe("do it");
  });

  it("never starts with \"!\", which Goose would run as a shell command", () => {
    const image = "![pasted-image.png](/tmp/a.webp)";
    expect(goosePrompt(plan(), image)).toBe(`\u200B${image}`);
    expect(goosePrompt(plan(), `  ${image}`).trimStart().startsWith("!")).toBe(false);
    expect(goosePrompt(plan(), "look at !this")).toBe("look at !this");
  });
});

describe("the argv a goose run is started with", () => {
  it("always asks for a JSON stream and caps the turns", () => {
    const args = gooseArgs(plan(), "do it");
    expect(args.slice(0, 5)).toEqual(["run", "--output-format", "stream-json", "--max-turns", String(GOOSE_MAX_TURNS)]);
    // The working directory is never an argument: Goose takes it from the process.
    expect(args).not.toContain("--cwd");
  });

  it("puts Weft's instructions in a new session's first message behind an endpoint that drops them", () => {
    const text = (p: Partial<import("./goose-recipe").GooseTurnPlan>) => {
      const args = gooseArgs(plan(p), "do it");
      return args[args.indexOf("--text") + 1] ?? "";
    };
    const opening = text({ instructionsInPrompt: true });
    expect(opening.startsWith("<weft-instructions>")).toBe(true);
    expect(opening).toContain(gooseSystemText(plan()));
    expect(opening.endsWith("</weft-instructions>\n\ndo it")).toBe(true);
    // A resumed session already has them; an endpoint that keeps the system prompt never needs them.
    expect(text({ instructionsInPrompt: true, resume: true })).toBe("do it");
    expect(text({})).toBe("do it");
  });

  it("carries on the card's Goose session only when it has one", () => {
    expect(gooseArgs(plan({ resume: true }), "do it")[5]).toBe("--resume");
    expect(gooseArgs(plan(), "do it")).not.toContain("--resume");
  });

  it("names the provider and the model when the card has them", () => {
    const args = gooseArgs(plan({ provider: "anthropic", model: "openai/gpt-4.1" }), "do it");
    expect(args[args.indexOf("--provider") + 1]).toBe("anthropic");
    expect(args[args.indexOf("--model") + 1]).toBe("openai/gpt-4.1");
  });

  it("leaves out the provider, the model and the instructions when there are none", () => {
    deps.weft = "";
    const args = gooseArgs(plan({ copilot: true }), "do it");
    expect(args).not.toContain("--provider");
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--system");
  });

  it("ends with the prompt", () => {
    const args = gooseArgs(plan(), "do it");
    expect(args.at(-2)).toBe("--text");
    expect(args.at(-1)).toBe("do it");
  });
});

describe("the recipe beside the turn", () => {
  it("is the same plan in Goose's own file format", () => {
    const yaml = gooseRecipeYaml(plan({ provider: "anthropic", model: "openai/gpt-4.1" }), "do it");
    expect(yaml).toContain('title: "Weft thread"');
    expect(yaml).toContain('prompt: "do it"');
    expect(yaml).toContain('  goose_provider: "anthropic"');
    expect(yaml).toContain('  goose_model: "openai/gpt-4.1"');
    expect(yaml).toContain(`  max_turns: ${GOOSE_MAX_TURNS}`);
    expect(yaml).toContain("parameters: []");
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("takes its own title", () => {
    expect(gooseRecipeYaml(plan(), "do it", "Nightly digest")).toContain('title: "Nightly digest"');
  });

  it("leaves out the provider, the model and the instructions when there are none", () => {
    deps.weft = "";
    const yaml = gooseRecipeYaml(plan({ copilot: true }), "do it");
    expect(yaml).not.toContain("goose_provider");
    expect(yaml).not.toContain("goose_model");
    expect(yaml).not.toContain("instructions:");
  });

  it("has no response block, which Goose's own validator rejects when empty", () => {
    expect(gooseRecipeYaml(plan(), "do it")).not.toContain("response:");
  });
});

describe("yamlString", () => {
  it("quotes a value, with the escapes YAML needs", () => {
    expect(yamlString("plain")).toBe('"plain"');
    expect(yamlString('a "quote"')).toBe('"a \\"quote\\""');
  });
});
