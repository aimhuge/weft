import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Card } from "./types";

// specFor takes a card's skill off-list from lib/skill-sets.ts. That file is keyed by cwd in
// DATA_DIR/skill-sets.json, so we redirect DATA_DIR to a temp dir before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-spec-skills-"));
process.env.WEFT_DATA = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

import { specFor } from "./runner-state";
import { setGooseModelId } from "./settings";
import { setProjectOff } from "./skill-sets";

// A card's spec is what the SDK's `query()` runs with: cwd, model, mode, read scope. The copilot
// gets one too, with a few fields pinned. Pure mapping; lib/runner-session.ts is where the spec
// turns into SDK options.
describe("specFor", () => {
  it("carries the card's read scope through as the SDK's additionalDirectories source", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      readScope: ["/Users/dev/deckcp"],
    };
    const spec = specFor(card);
    expect(spec.readScope).toEqual(["/Users/dev/deckcp"]);
    expect(spec.cwd).toBe("/Users/dev/weft");
  });

  it("carries the copilot's persona, and no other card's", () => {
    const base: Card = { id: "c1", title: "T", prompt: "", cwd: "/", backend: "claude", permissionMode: "default", column: "backlog", createdAt: 0, updatedAt: 0, persona: "captain" };
    expect(specFor({ ...base, role: "copilot" })).toMatchObject({ copilot: true, persona: "captain" });
    expect(specFor(base).persona).toBeUndefined();
  });

  it("drops the read scope when the card has none", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
    };
    const spec = specFor(card);
    expect(spec.readScope).toBeUndefined();
  });

  it("drops an empty read scope so the SDK doesn't get [].", () => {
    const card: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      readScope: [],
    };
    const spec = specFor(card);
    expect(spec.readScope).toBeUndefined();
  });

  it("pins the copilot's role flag", () => {
    const card: Card = {
      id: "copilot",
      title: "Copilot",
      prompt: "",
      cwd: "/Users/dev/weft",
      backend: "claude",
      permissionMode: "default",
      column: "running",
      createdAt: 0,
      updatedAt: 0,
      role: "copilot",
    };
    expect(specFor(card).copilot).toBe(true);
  });

  it("sets skillsOff from the card's own list, the project's off-list, and never for the copilot", () => {
    const cwd = "/Users/dev/spec-skills";
    setProjectOff(cwd, ["project-skill"]);
    const thread: Card = {
      id: "c1",
      title: "T",
      prompt: "do it",
      cwd,
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      skillsOff: ["card-skill"],
    };
    expect(specFor(thread).skillsOff).toEqual(["card-skill", "project-skill"]);
    // The copilot runs the board, so it keeps every skill.
    const copilot: Card = { ...thread, id: "cp", role: "copilot" };
    expect(specFor(copilot).skillsOff).toBeUndefined();
    // A card with nothing in the project's or its own off-list gets an empty one.
    const bare: Card = { ...thread, id: "b", skillsOff: undefined };
    expect(specFor(bare).skillsOff).toEqual(["project-skill"]);
  });
});

// A cron's fork run (lib/cron-run.ts) starts as a copy of the source's session: the card carries the
// session and the entry to resume at in forkOf, and never writes back to the source's own session.
describe("specFor on a forked card", () => {
  const base: Card = { id: "c1", title: "T", prompt: "", cwd: "/", backend: "claude", permissionMode: "default", column: "backlog", createdAt: 0, updatedAt: 0 };

  it("takes the session from forkOf and resumes at its anchor", () => {
    const spec = specFor({ ...base, forkOf: { sessionId: "sess-1", at: "uuid-anchor" } });
    expect(spec.sessionId).toBe("sess-1");
    expect(spec.forkSession).toBe(true);
    expect(spec.resumeAt).toBe("uuid-anchor");
  });

  it("forks with no anchor when the cron had none", () => {
    const spec = specFor({ ...base, forkOf: { sessionId: "sess-1" } });
    expect(spec.sessionId).toBe("sess-1");
    expect(spec.forkSession).toBe(true);
    expect(spec.resumeAt).toBeUndefined();
  });

  it("ignores forkOf when the card has a session of its own", () => {
    const spec = specFor({ ...base, sessionId: "own-session", forkOf: { sessionId: "sess-1", at: "uuid-anchor" } });
    expect(spec.sessionId).toBe("own-session");
    expect(spec.forkSession).toBeUndefined();
    expect(spec.resumeAt).toBeUndefined();
  });

  it("is no fork at all when the card has neither", () => {
    const spec = specFor(base);
    expect(spec.sessionId).toBeUndefined();
    expect(spec.forkSession).toBeUndefined();
    expect(spec.resumeAt).toBeUndefined();
  });
});

// A Goose card runs the model it was given (the New thread dialog, a mid-thread switch), as a Claude Code or
// puku-cli card does; the model picked in Settings → Models → Bring your own key only fills in "Goose default".
describe("specFor on a Goose card", () => {
  const goose: Card = { id: "g1", title: "T", prompt: "", cwd: "/", backend: "goose", permissionMode: "default", column: "backlog", createdAt: 0, updatedAt: 0 };
  afterAll(() => setGooseModelId(""));

  it("runs the card's own model over the one picked in Settings", () => {
    setGooseModelId("puku-ai-2.8");
    expect(specFor({ ...goose, model: "openai/gpt-4.1" }).model).toBe("openai/gpt-4.1");
  });

  it("falls back to the Settings model when the card is on Goose default", () => {
    setGooseModelId("puku-ai-2.8");
    expect(specFor({ ...goose, model: "goose-default" }).model).toBe("puku-ai-2.8");
    expect(specFor(goose).model).toBe("puku-ai-2.8");
  });

  it("leaves the model to Goose with neither", () => {
    setGooseModelId("");
    expect(specFor({ ...goose, model: "goose-default" }).model).toBeUndefined();
  });

  it("never gives a Claude Code card the Goose Settings model", () => {
    setGooseModelId("puku-ai-2.8");
    expect(specFor({ ...goose, backend: "claude" }).model).toBeUndefined();
  });
});
