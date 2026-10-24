import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { baseEnv, createSecretRun, describe as describeRun, runApproval, secretRunRoutes, GRANT_MS, REPLY_CHARS } from "./secret-run.cjs";

// Real child processes (node scripts in a temp folder), a fake vault and fake rules.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-secret-run-"));
const script = (name: string, body: string) => {
  fs.writeFileSync(path.join(dir, name), body);
  return [process.execPath, path.join(dir, name)];
};
const PRINT = script("print.js", "console.log('url=' + process.env.DATABASE_URL); console.error('b64=' + Buffer.from(process.env.DATABASE_URL).toString('base64')); console.log('token=' + (process.env.WEFT_SHELL_TOKEN || 'none') + ' mode=' + process.env.MODE); process.exit(3);");
const SLEEP = script("sleep.js", "process.on('SIGTERM', () => {}); console.log('started'); setInterval(() => {}, 1000);");
const BIG = script("big.js", `process.stdout.write('first-line\\n' + 'x'.repeat(${REPLY_CHARS + 50}) + '\\nlast');`);

const URL = "postgres://app:hunter2-very-secret@db.example.com/app";

type Options = { values?: Record<string, string>; missing?: string[]; allows?: boolean; choice?: string | null };
type Runner = ReturnType<typeof createSecretRun>;

function make({ values = { DATABASE_URL: URL }, missing = [], allows = false, choice = "once" }: Options = {}) {
  const vault = { valuesFor: vi.fn(() => Promise.resolve({ id: "github:o/r", label: "o/r", values, missing })) };
  const rules = { allows: vi.fn(() => allows), remember: vi.fn() };
  const ask = vi.fn(() => Promise.resolve(choice));
  let t = 1000;
  const runner = createSecretRun({ vault, rules, ask, spawn, env: { ...process.env, WEFT_SHELL_TOKEN: "tok" }, now: () => (t += 100), randomId: () => "grant-1", node: "/Electron", runner: "/app/secret-env.cjs" });
  return { runner, vault, rules, ask };
}

const request = { key: "c1", folder: dir, cwd: dir, command: "node print.js", names: ["DATABASE_URL"], environment: "development", script: undefined };

describe("createSecretRun.run", () => {
  it("runs the command with the values in its env only, and hands back redacted output and the exit code", async () => {
    const { runner, vault, ask, rules } = make();
    const r = await runner.run({ ...request, argv: PRINT, env: { MODE: "job" } });
    expect(vault.valuesFor).toHaveBeenCalledWith(dir, ["DATABASE_URL"], "development");
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ message: "A thread wants to run a command with secrets from o/r." }));
    expect(rules.remember).not.toHaveBeenCalled();
    expect(r).toMatchObject({ label: "o/r", exitCode: 3, signal: null, timedOut: false, truncated: false });
    expect(r.output).toContain("url=‹DATABASE_URL›");
    expect(r.output).toContain("b64=‹DATABASE_URL›");
    expect(r.output).toContain("token=none mode=job");
    expect(r.output).not.toContain("hunter2");
    expect(runner.redact("c1", `leak ${URL}`)).toBe("leak ‹DATABASE_URL›");
    expect(runner.redact("other", `leak ${URL}`)).toBe(`leak ${URL}`);
    expect(runner.redact("other", undefined)).toBe("");
  });

  it("remembers an Always allow, and skips asking when a rule covers it", async () => {
    const always = make({ choice: "always" });
    await always.runner.run({ ...request, argv: PRINT });
    expect(always.rules.remember).toHaveBeenCalledWith({ id: "github:o/r", environment: "development", cwd: dir, command: "node print.js", script: undefined, kind: "run" }, ["DATABASE_URL"]);
    const covered = make({ allows: true });
    await covered.runner.run({ ...request, argv: PRINT });
    expect(covered.ask).not.toHaveBeenCalled();
  });

  it("stops at missing names or a no, without running anything", async () => {
    expect(await make({ missing: ["DATABASE_URL"] }).runner.run({ ...request, argv: PRINT })).toEqual({ missing: ["DATABASE_URL"], label: "o/r" });
    const no = make({ choice: null });
    expect(await no.runner.run({ ...request, argv: PRINT })).toEqual({ denied: true, label: "o/r" });
    expect(no.runner.redact("c1", URL)).toBe(URL);
  });

  it("stops a command that runs too long, SIGKILL after the grace period", async () => {
    const { vault } = make();
    const runner = createSecretRun({ vault, rules: { allows: () => true, remember: vi.fn() }, ask: vi.fn(), spawn, killGraceMs: 100 });
    const r = await runner.run({ ...request, argv: SLEEP, timeoutMs: 600 });
    expect(r).toMatchObject({ timedOut: true, signal: "SIGKILL", output: "started\n" });
  });

  it("cuts long output from the start, dropping the cut line", async () => {
    const r = await make({ allows: true }).runner.run({ ...request, argv: BIG });
    expect(r.truncated).toBe(true);
    expect(r.output?.startsWith("x")).toBe(false);
    expect(r.output?.endsWith("last")).toBe(true);
  });

  it("reports a program that can't start", async () => {
    const r = await make({ allows: true }).runner.run({ ...request, argv: [path.join(dir, "no-such-program")] });
    expect(r.exitCode).toBeNull();
    expect(r.output).toContain("ENOENT");
    const throws = createSecretRun({ vault: make().vault, rules: { allows: () => true, remember: vi.fn() }, ask: vi.fn(), spawn: () => { throw new Error("spawn blew up"); } });
    expect(await throws.run({ ...request, argv: ["x"] })).toMatchObject({ exitCode: null, output: "spawn blew up" });
  });

  it("falls back to killing the child when its process group is gone", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const child = Object.assign(new (await import("node:events")).EventEmitter(), {
      pid: 1,
      stdout: new (await import("node:events")).EventEmitter(),
      stderr: new (await import("node:events")).EventEmitter(),
      kill: vi.fn(function (this: { emit: (e: string, ...a: unknown[]) => void }) {
        this.emit("close", null, "SIGTERM");
      }),
    });
    const timers: (() => void)[] = [];
    const runner = createSecretRun({ vault: make().vault, rules: { allows: () => true, remember: vi.fn() }, ask: vi.fn(), spawn: () => child, setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout, clearTimer: () => {} });
    const done = runner.run({ ...request, argv: ["x"] });
    await vi.waitFor(() => expect(timers.length).toBe(1));
    timers[0]!();
    expect(await done).toMatchObject({ timedOut: true, signal: "SIGTERM" });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    kill.mockRestore();
  });
});

describe("createSecretRun dev grants", () => {
  it("grants a dev server every development value once, after approval", async () => {
    const { runner, vault, ask } = make({ values: { A: "alpha-value-1", B: "bravo-value-2" } });
    const g = await runner.devGrant({ key: "c2", folder: dir, cwd: dir, command: "npm run dev", script: "dev: next dev" });
    expect(vault.valuesFor).toHaveBeenCalledWith(dir, null, "development");
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ message: "Start this card's dev server with o/r's development secrets?" }));
    expect(g).toEqual({ grant: "grant-1", names: ["A", "B"], label: "o/r", node: "/Electron", runner: "/app/secret-env.cjs" });
    expect(runner.claim("grant-1")).toEqual({ env: { A: "alpha-value-1", B: "bravo-value-2" } });
    expect(() => runner.claim("grant-1")).toThrow(/already used or has expired/);
    expect(runner.redact("c2", "alpha-value-1")).toBe("‹A›");
  });

  it("has nothing to grant without values, or after a no; grants expire", async () => {
    expect(await make({ values: {} }).runner.devGrant({ key: "c", folder: dir, cwd: dir, command: "npm run dev" })).toEqual({ names: [] });
    expect(await make({ choice: null }).runner.devGrant({ key: "c", folder: dir, cwd: dir, command: "npm run dev" })).toEqual({ denied: true, names: ["DATABASE_URL"], label: "o/r" });
    let t = 0;
    const late = createSecretRun({ vault: make().vault, rules: { allows: () => true, remember: vi.fn() }, ask: vi.fn(), spawn, now: () => t, randomId: () => "g" });
    await late.devGrant({ key: undefined, folder: dir, cwd: dir, command: "npm run dev" });
    // (script is optional: a dev command with no package.json script behind it)
    t = GRANT_MS + 1;
    expect(() => late.claim("g")).toThrow(/expired/);
  });
});

describe("helpers", () => {
  it("drops Weft's own variables from a command's env", () => {
    expect(baseEnv({ PATH: "/bin", WEFT_SHELL_TOKEN: "t", WEFT_SHELL_URL: "u", ELECTRON_RUN_AS_NODE: "1" })).toEqual({ PATH: "/bin" });
  });

  it("describes the request for the approval", () => {
    expect(describeRun({ kind: "run", command: "npm run job", cwd: "/p", script: "job: node j.js", names: ["A", "B"], environment: "production", label: "o/r" })).toEqual({
      message: "A thread wants to run a command with secrets from o/r.",
      detail: "Command: npm run job\n\nIn: /p\n\nRuns:\njob: node j.js\n\nSecrets (production): A, B\n\nThe thread won't see the values; they're shown as ‹NAME› in its output.\n\nAlways lasts until the code in this folder changes; then Weft asks again.",
      reason: 'run "npm run job" with A, B (o/r)',
      view: { kind: "run", command: "npm run job", cwd: "/p", script: "job: node j.js", names: ["A", "B"], environment: "production", label: "o/r" },
    });
  });

  it("names the asking card and says why, in the message, the detail, Touch ID and the window", () => {
    const run = describeRun({ kind: "run", command: "node send.js", cwd: "/p", names: ["K"], environment: "development", label: "o/r", thread: "Email forwarding", why: "Send a test email" });
    expect(run.message).toBe('"Email forwarding" wants to run a command with secrets from o/r.');
    expect(run.detail.startsWith("Why: Send a test email\n\nCommand: node send.js")).toBe(true);
    expect(run.reason).toBe('run "node send.js" with K (o/r) for "Email forwarding"');
    expect(run.view).toMatchObject({ thread: "Email forwarding", why: "Send a test email" });
    expect(describeRun({ kind: "dev", command: "npm run dev", cwd: "/p", names: ["K"], environment: "development", label: "o/r", thread: "Site" }).message).toBe(
      "Start \"Site\"'s dev server with o/r's development secrets?",
    );
  });

  it("asks with a dialog, then Touch ID where there is one", async () => {
    const dialog = { showMessageBox: vi.fn() };
    const win = {};
    const touch = { canPromptTouchID: () => true, promptTouchID: vi.fn(async () => {}) };
    const ask = runApproval({ dialog, systemPreferences: touch, window: () => win });
    const req = { message: "m", detail: "d", reason: "r" };
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await ask(req)).toBeNull();
    expect(touch.promptTouchID).not.toHaveBeenCalled();
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await ask(req)).toBe("once");
    expect(touch.promptTouchID).toHaveBeenCalledWith("r");
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 });
    expect(await ask(req)).toBe("always");
    expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ buttons: ["Cancel", "Allow once", "Always allow"], message: "m", detail: "d" }));
    touch.promptTouchID.mockRejectedValueOnce(new Error("cancelled"));
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await ask(req)).toBeNull();
    const noTouch = runApproval({ dialog, systemPreferences: {}, window: () => win });
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 });
    expect(await noTouch(req)).toBe("always");
  });

  it("hands Touch ID to the window, so a touch there is the whole approval", async () => {
    const dialog = { showMessageBox: vi.fn() };
    const touch = { canPromptTouchID: () => true, promptTouchID: vi.fn(async () => {}) };
    const askWindow = vi.fn(async ({ touch: t }: { touch?: () => Promise<boolean> }) => ((await t?.()) ? "once" : null));
    const ask = runApproval({ dialog, systemPreferences: touch, window: () => ({}), askWindow });
    const req = { message: "m", detail: "d", reason: "r", view: { command: "x" } };
    expect(await ask(req)).toBe("once");
    expect(touch.promptTouchID).toHaveBeenCalledTimes(1);
    touch.promptTouchID.mockRejectedValueOnce(new Error("cancelled"));
    expect(await ask(req)).toBeNull();
    const noTouch = runApproval({ dialog, systemPreferences: {}, window: () => ({}), askWindow: vi.fn((o: { touch?: unknown }) => Promise.resolve(o.touch ? "bad" : "always")) });
    expect(await noTouch(req)).toBe("always");
    const broken = runApproval({ dialog, systemPreferences: touch, window: () => ({}), askWindow: vi.fn(() => Promise.reject(new Error("no window"))) });
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await broken(req)).toBe("once");
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("routes the control server's requests, defaulting to the active card", async () => {
    const r = { run: vi.fn((b: unknown) => Promise.resolve(b)), devGrant: vi.fn((b: unknown) => Promise.resolve(b)), claim: vi.fn((g: string) => ({ env: g })) } as unknown as Runner;
    const routes = secretRunRoutes(() => r, () => "active");
    expect(await routes["POST /secrets/run"]({ command: "x" })).toEqual({ command: "x", key: "active" });
    expect(await routes["POST /secrets/run"]({ key: "k" })).toEqual({ key: "k" });
    expect(await routes["POST /secrets/dev-grant"]({ key: "k" })).toEqual({ key: "k" });
    expect(routes["POST /secrets/claim"]({ grant: "g" }) as unknown).toEqual({ env: "g" });
    const none = secretRunRoutes(() => undefined);
    expect(() => none["POST /secrets/claim"]({})).toThrow("The secrets vault isn't ready yet.");
    expect(() => none["POST /secrets/run"]({})).toThrow();
  });
});
