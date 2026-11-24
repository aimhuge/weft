import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../runner-state";
import { UNANSWERED } from "./answer";
import { antigravityToken } from "./antigravity-turns";

// Weft's guards on an Antigravity thread (lib/guards/antigravity.ts): one "weft-guards" entry in agy's shared
// hooks.json, a hook command that's inert outside Weft, and the conversation bound to the turn's guard token.
// openGuards needs the server's port, so it's faked: lib/guards/turn.ts has its own tests.

const s = vi.hoisted(() => ({ closed: 0, fail: null as null | Error }));
vi.mock("./turn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./turn")>()),
  openGuards: vi.fn((_session: unknown, cli: string) => {
    if (s.fail) throw s.fail;
    return { token: `tok-${cli}`, url: "http://127.0.0.1:7/api/guards", env: {}, close: () => { s.closed++; } };
  }),
}));

const g = await import("./antigravity");
const { GuardsUnavailable } = await import("./turn");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-agy-guards-"));
let dir: string;
let n = 0;
const hooksFile = () => path.join(dir, "hooks.json");
const session = { cardId: "card-1" } as unknown as Session;

beforeEach(() => {
  dir = path.join(root, `config-${++n}`);
  s.closed = 0;
  s.fail = null;
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("agyConfigDir", () => {
  it("is ~/.gemini/config, under the home it's given", () => {
    expect(g.agyConfigDir("/h")).toBe(path.join("/h", ".gemini", "config"));
    expect(g.agyConfigDir()).toBe(path.join(os.homedir(), ".gemini", "config"));
  });
});

describe("weftHookEntry", () => {
  it("is a hook before and after every tool and before each model call, each running its command with an hour to answer", () => {
    const handler = (event: (typeof g.AGY_HOOK_EVENTS)[number]) => ({ type: "command", command: g.agyHookCommand(event), timeout: 3600 });
    expect(g.weftHookEntry()).toEqual({
      PreToolUse: [{ matcher: "*", hooks: [handler("PreToolUse")] }],
      PostToolUse: [{ matcher: "*", hooks: [handler("PostToolUse")] }],
      // Not a tool event: its handlers sit straight under it, with no matcher.
      PreInvocation: [handler("PreInvocation")],
    });
    expect(g.HOOK_NAME).toBe("weft-guards");
    expect(g.AGY_HOOK_EVENTS).toEqual(["PreToolUse", "PostToolUse", "PreInvocation"]);
  });
});

describe("agyHookCommand", () => {
  it("is the PreToolUse command by default, and posts each event to its own route", () => {
    expect(g.agyHookCommand()).toBe(g.agyHookCommand("PreToolUse"));
    for (const event of g.AGY_HOOK_EVENTS) expect(g.agyHookCommand(event)).toContain(`"$WEFT_GUARD_URL/antigravity/${event}"`);
  });
});

describe("withWeftHook", () => {
  it("is Weft's entry alone for no file or an empty one", () => {
    for (const existing of [undefined, "", "  \n"]) expect(JSON.parse(g.withWeftHook(existing))).toEqual({ "weft-guards": g.weftHookEntry() });
    expect(g.withWeftHook(undefined).endsWith("}\n")).toBe(true);
  });

  it("keeps every other entry and replaces an old Weft entry", () => {
    const existing = JSON.stringify({ mine: { PreToolUse: [] }, "weft-guards": { old: true } });
    expect(JSON.parse(g.withWeftHook(existing))).toEqual({ mine: { PreToolUse: [] }, "weft-guards": g.weftHookEntry() });
  });

  it("throws on a file that isn't a JSON object", () => {
    for (const bad of ["null", "[]", "3", '"x"']) expect(() => g.withWeftHook(bad)).toThrow("hooks.json isn't a JSON object");
    expect(() => g.withWeftHook("{half")).toThrow(SyntaxError);
  });
});

describe("installAgyHook", () => {
  it("makes the folder and writes the file when there's none", () => {
    g.installAgyHook(dir);
    expect(JSON.parse(fs.readFileSync(hooksFile(), "utf8"))).toEqual({ "weft-guards": g.weftHookEntry() });
    // Written through a temp file, which is gone after the rename.
    expect(fs.readdirSync(dir)).toEqual(["hooks.json"]);
  });

  it("merges into an existing file, keeping its other entries", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hooksFile(), JSON.stringify({ mine: { PreToolUse: [{ matcher: "x" }] } }));
    g.installAgyHook(dir);
    expect(JSON.parse(fs.readFileSync(hooksFile(), "utf8"))).toEqual({ mine: { PreToolUse: [{ matcher: "x" }] }, "weft-guards": g.weftHookEntry() });
  });

  it("doesn't rewrite a file that already has the entry", () => {
    g.installAgyHook(dir);
    const old = new Date(2000, 0, 1);
    fs.utimesSync(hooksFile(), old, old);
    const write = vi.spyOn(fs, "writeFileSync");
    g.installAgyHook(dir);
    expect(write).not.toHaveBeenCalled();
    expect(fs.statSync(hooksFile()).mtime.getTime()).toBe(old.getTime());
    write.mockRestore();
  });
});

describe("openAgyGuards", () => {
  it("installs the hook, gives agy the route's address, and binds conversations to the turn's token until it closes", () => {
    const guards = g.openAgyGuards(session, dir);
    expect(fs.existsSync(hooksFile())).toBe(true);
    expect(guards.env).toEqual({ WEFT_GUARD_URL: "http://127.0.0.1:7/api/guards" });
    guards.bind("conv-1");
    guards.bind("conv-2");
    expect(antigravityToken({ conversationId: "conv-1" })).toBe("tok-antigravity");
    expect(antigravityToken({ conversationId: "conv-2" })).toBe("tok-antigravity");
    guards.close();
    expect(antigravityToken({ conversationId: "conv-1" })).toBeUndefined();
    expect(antigravityToken({ conversationId: "conv-2" })).toBeUndefined();
    expect(s.closed).toBe(1);
  });

  it("throws GuardsUnavailable and closes the guards on a hooks.json that isn't an object, leaving it as it was", () => {
    fs.mkdirSync(dir, { recursive: true });
    for (const bad of ["[1]", "{not json"]) {
      fs.writeFileSync(hooksFile(), bad);
      let err: unknown;
      try {
        g.openAgyGuards(session, dir);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GuardsUnavailable);
      expect((err as Error).message).toContain(`Weft's hook couldn't be added to ${hooksFile()}`);
      expect(fs.readFileSync(hooksFile(), "utf8")).toBe(bad);
    }
    fs.writeFileSync(hooksFile(), "[1]");
    expect(() => g.openAgyGuards(session, dir)).toThrow("hooks.json isn't a JSON object");
    expect(s.closed).toBe(3);
  });

  it("names a failure that isn't an Error", () => {
    const exists = vi.spyOn(fs, "existsSync").mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what's under test: a throw that isn't an Error
      throw "disk gone";
    });
    expect(() => g.openAgyGuards(session, dir)).toThrow("disk gone");
    exists.mockRestore();
    expect(s.closed).toBe(1);
  });

  it("passes on openGuards' own failure", () => {
    s.fail = new GuardsUnavailable("no port");
    expect(() => g.openAgyGuards(session, dir)).toThrow("no port");
    expect(fs.existsSync(hooksFile())).toBe(false);
  });
});

// The hook command, run for real in sh with a fake curl standing in for Weft's server.
describe("agyHookCommand, run", () => {
  const bin = path.join(root, "bin");
  const argvFile = path.join(root, "argv.txt");
  fs.mkdirSync(bin, { recursive: true });
  const fakeCurl = (body: string, exit = 0) =>
    fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\ncat >/dev/null\nprintf '%s' ${JSON.stringify(body)}\nexit ${exit}\n`, { mode: 0o755 });
  const run = (env: Record<string, string>, event: (typeof g.AGY_HOOK_EVENTS)[number] = "PreToolUse") =>
    execFileSync("/bin/sh", ["-c", g.agyHookCommand(event)], { env: { PATH: `${bin}:${process.env.PATH ?? ""}`, ...env } as unknown as NodeJS.ProcessEnv, input: `{"hookEventName":"${event}"}`, encoding: "utf8" });

  it("lets every call through outside a Weft thread, without asking anyone", () => {
    fakeCurl("SHOULD NOT RUN");
    fs.rmSync(argvFile, { force: true });
    expect(JSON.parse(run({}))).toEqual({ decision: "allow" });
    expect(fs.existsSync(argvFile)).toBe(false);
  });

  it("prints what Weft's guard route answered, posted to its Antigravity route", () => {
    fakeCurl('{"decision":"deny","reason":"No .env reads."}');
    expect(run({ WEFT_GUARD_URL: "http://127.0.0.1:9/api/guards" })).toBe('{"decision":"deny","reason":"No .env reads."}\n');
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");
    expect(argv).toContain("http://127.0.0.1:9/api/guards/antigravity/PreToolUse");
    expect(argv.join(" ")).not.toContain("Authorization");
  });

  it("refuses the call when Weft doesn't answer", () => {
    fakeCurl("", 22);
    expect(JSON.parse(run({ WEFT_GUARD_URL: "http://127.0.0.1:9/api/guards" }))).toEqual({ decision: "deny", reason: UNANSWERED });
  });

  for (const event of ["PostToolUse", "PreInvocation"] as const) {
    describe(event, () => {
      it("changes nothing outside a Weft thread, without asking anyone", () => {
        fakeCurl("SHOULD NOT RUN");
        fs.rmSync(argvFile, { force: true });
        expect(run({}, event)).toBe("{}\n");
        expect(fs.existsSync(argvFile)).toBe(false);
      });

      it(`prints what Weft's guard route answered, posted to /antigravity/${event}`, () => {
        fakeCurl('{"injectSteps":[]}');
        expect(run({ WEFT_GUARD_URL: "http://127.0.0.1:9/api/guards" }, event)).toBe('{"injectSteps":[]}\n');
        const argv = fs.readFileSync(argvFile, "utf8").split("\n");
        expect(argv).toContain(`http://127.0.0.1:9/api/guards/antigravity/${event}`);
        expect(argv.join(" ")).not.toContain("Authorization");
      });

      it("changes nothing when Weft doesn't answer, rather than refusing", () => {
        fakeCurl("", 22);
        expect(run({ WEFT_GUARD_URL: "http://127.0.0.1:9/api/guards" }, event)).toBe("{}\n");
      });
    });
  }
});
