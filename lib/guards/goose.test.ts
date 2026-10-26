import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessions, type Session } from "../runner-state";
import { addCards, deleteCard } from "../store";
import type { Card } from "../types";
import { gooseGuardsDir, gooseHooksJson, openGooseGuards } from "./goose";
import * as turn from "./turn";
import { guardTurn, GuardsUnavailable } from "./turn";

const actualOpenGuards = turn.openGuards;

// Weft's guards on a Goose turn: the plugin Weft writes in the card's own Goose state root, whose hooks send
// every tool call to Weft's guard route. Goose can't start without them, so a plugin that can't be written
// stops the turn.

const PORT = "1034";
const cwd = process.cwd();

const card: Card = {
  id: "guard-goose-card",
  title: "Goose",
  prompt: "",
  cwd,
  backend: "goose",
  permissionMode: "bypassPermissions",
  column: "running",
  createdAt: 1,
  updatedAt: 1,
};
const session = { cardId: card.id, spec: { cwd, permissionMode: "bypassPermissions", backend: "goose" }, pending: [], abort: new AbortController(), busy: true, retryGrants: [] } as unknown as Session;

beforeAll(() => {
  vi.stubEnv("PORT", PORT);
  addCards([card]);
  sessions.set(card.id, session);
});

afterAll(() => {
  sessions.delete(card.id);
  deleteCard(card.id);
  vi.unstubAllEnvs();
});

describe("gooseHooksJson", () => {
  const hooks = JSON.parse(gooseHooksJson({ url: "http://127.0.0.1:1034/api/guards", token: "tok-123" })) as {
    hooks: Record<string, { matcher: string; hooks: { type: string; timeout: number; command: string }[] }[]>;
  };

  it("hooks every event a Goose tool call can reach", () => {
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PostToolUse", "PostToolUseFailure", "PreToolUse"]);
  });

  it("matches every tool and lets an ask wait for the card", () => {
    for (const [, matchers] of Object.entries(hooks.hooks)) {
      const [matcher] = matchers;
      expect(matcher?.matcher).toBe(".*");
      expect(matcher?.hooks[0]?.type).toBe("command");
      expect(matcher?.hooks[0]?.timeout).toBe(3600);
    }
  });

  it("puts the route and the token in the command, where Goose's shell can't show them", () => {
    for (const [event, matchers] of Object.entries(hooks.hooks)) {
      const command = matchers[0]?.hooks[0]?.command;
      expect(command).toContain(`http://127.0.0.1:1034/api/guards/goose/${event}`);
      expect(command).toContain("tok-123");
      expect(command).not.toContain("$WEFT_GUARD_TOKEN");
    }
  });
});

describe("openGooseGuards", () => {
  it("writes the plugin in the card's own Goose state root", () => {
    const dir = gooseGuardsDir(card.id);
    expect(dir).toBe(path.join(process.env.WEFT_DATA as string, "goose", card.id, ".agents", "plugins", "weft-guards"));

    const close = openGooseGuards(session);
    expect(fs.existsSync(path.join(dir, ".plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "hooks", "hooks.json"))).toBe(true);
    close();
  });

  it("keeps the token out of reach, in a file only the user can read", () => {
    const close = openGooseGuards(session);
    const file = path.join(gooseGuardsDir(card.id), "hooks", "hooks.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    close();
  });

  it("writes a manifest naming the plugin", () => {
    const close = openGooseGuards(session);
    const manifest = JSON.parse(fs.readFileSync(path.join(gooseGuardsDir(card.id), ".plugin", "plugin.json"), "utf8")) as { name: string; version: string };
    expect(manifest.name).toBe("weft-guards");
    expect(manifest.version).toBe("1.0.0");
    close();
  });

  it("closes the turn and takes the plugin's hooks away when the turn is over", () => {
    const close = openGooseGuards(session);
    const file = path.join(gooseGuardsDir(card.id), "hooks", "hooks.json");
    expect(fs.existsSync(file)).toBe(true);
    close();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses to open when the plugin can't be written, and closes the turn it opened", () => {
    // A file where the plugin's folder should be: nothing can be written under it.
    const dir = gooseGuardsDir(card.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, "not a folder");

    // The turn it opens on the way is the one whose token must stop working.
    const opened: string[] = [];
    const spy = vi.spyOn(turn, "openGuards");
    spy.mockImplementation((...args) => {
      const guards = actualOpenGuards(...args);
      opened.push(guards.token);
      return guards;
    });

    expect(() => openGooseGuards(session)).toThrow(GuardsUnavailable);
    expect(() => openGooseGuards(session)).toThrow(/the Goose plugin couldn't be written/);

    // The turn it opened on the way is closed again, so its token answers nothing.
    expect(opened).toHaveLength(2);
    for (const token of opened) expect(guardTurn(token, "goose")).toBeUndefined();

    spy.mockRestore();
    fs.rmSync(dir, { force: true });
  });

  it("says why in words when writing fails with something that isn't an Error", () => {
    const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test is a thrown non-Error
      throw "disk full";
    });
    expect(() => openGooseGuards(session)).toThrow(/couldn't be written: disk full/);
    write.mockRestore();
  });
});
