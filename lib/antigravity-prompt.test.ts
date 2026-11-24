import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";
import type { PermissionMode } from "./types";

// What an Antigravity thread is told and runs with (lib/antigravity-prompt.ts). Weft's own prompt, the project's
// instructions and the skills are faked: each has its own tests.

const s = vi.hoisted(() => ({ project: "", skills: "", calls: [] as unknown[][] }));

vi.mock("./weft-prompts", () => ({ weftSystemPrompt: (spec: unknown) => (s.calls.push(["prompt", spec]), "WEFT PROMPT") }));
vi.mock("./puku-context", () => ({ codexProjectInstructions: (cwd: string) => (s.calls.push(["project", cwd]), s.project) }));
vi.mock("./skills", () => ({
  skillIndex: (cwd: string, opts: unknown) => (s.calls.push(["skills", cwd, opts]), s.skills),
  skillInvocation: (text: string, cwd: string, opts: unknown) => (s.calls.push(["invoke", text, cwd, opts]), `SKILL(${text})`),
}));
vi.mock("./new-thread", () => ({ ANTIGRAVITY_DEFAULT_MODEL: "antigravity-default" }));

const p = await import("./antigravity-prompt");

const session = { spec: { cwd: "/w", copilot: false, persona: "builder", agent: "a1", project: "/proj", skillsOff: ["x"] } } as unknown as Session;

beforeEach(() => {
  s.project = "";
  s.skills = "";
  s.calls.length = 0;
});

describe("agySystemAppend", () => {
  it("is Weft's prompt alone when the folder has no instructions or skills", () => {
    expect(p.agySystemAppend(session)).toBe("WEFT PROMPT");
    expect(s.calls).toEqual([
      ["prompt", { backend: "antigravity", copilot: false, persona: "builder", agent: "a1", project: "/proj" }],
      ["project", "/w"],
      ["skills", "/w", { weft: true, off: ["x"] }],
    ]);
  });

  it("adds the project's instructions and the skill index after it", () => {
    s.project = "Use pnpm.";
    s.skills = "# Skills\n- /done";
    const out = p.agySystemAppend(session);
    expect(out.split("\n\n")[0]).toBe("WEFT PROMPT");
    expect(out).toContain("# Project instructions\nAntigravity doesn't load CLAUDE.md");
    expect(out).toContain("Use pnpm.");
    expect(out.endsWith("# Skills\n- /done")).toBe(true);
  });
});

describe("agyPrompt", () => {
  it("turns a /name into the skill's instructions", () => {
    expect(p.agyPrompt(session, "/done")).toBe("SKILL(/done)");
    expect(s.calls).toEqual([["invoke", "/done", "/w", { weft: true }]]);
  });
});

describe("agyMode", () => {
  it("runs Accept edits and Bypass on accept-edits, Auto on auto, and the rest on default", () => {
    expect(p.agyMode("acceptEdits")).toBe("accept-edits");
    expect(p.agyMode("bypassPermissions")).toBe("accept-edits");
    expect(p.agyMode("auto")).toBe("auto");
    expect(p.agyMode("default")).toBe("default");
    expect(p.agyMode("plan" as PermissionMode)).toBe("default");
  });
});

describe("agyModel", () => {
  it("is the pinned slug, or undefined for none or agy's own default", () => {
    expect(p.agyModel("gemini-3-pro")).toBe("gemini-3-pro");
    expect(p.agyModel(undefined)).toBeUndefined();
    expect(p.agyModel("")).toBeUndefined();
    expect(p.agyModel("antigravity-default")).toBeUndefined();
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(p.ANTIGRAVITY_PROMPT_CODE).toEqual([p.agySystemAppend, p.agyPrompt, p.agyMode, p.agyModel]);
});
