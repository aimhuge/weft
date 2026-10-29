import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));

vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const sr = await import("./secret-run");
const { cardProof } = await import("./card-token");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true) => fetchMock.mockResolvedValueOnce({ ok, statusText: "Bad", json: () => Promise.resolve(data) });
const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

const proj = fs.mkdtempSync(path.join(os.tmpdir(), "weft-run-"));
fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { job: "node job.js" } }));

// Each test gets its own card, since the cards marked as using secrets last for the server's life.
let n = 0;
let card: string | undefined = "c0";
const run = sr.runTool(() => card, () => proj) as unknown as { name: string; handler: Handler };
const said = (r: Result) => r.content[0]?.text;

beforeEach(() => {
  fetchMock.mockReset();
  card = `c${++n}`;
});

describe("runTool", () => {
  it("is mcp__secrets__run, and its prompt names it", () => {
    expect(run.name).toBe("run");
    expect(sr.RUN_PROMPT).toContain("mcp__secrets__run");
  });

  it("sends the checked command to main and reports the redacted output", async () => {
    reply({ label: "o/r", exitCode: 0, signal: null, timedOut: false, output: "connected to ‹DATABASE_URL›\n", truncated: false, ms: 1234 });
    const r = await run.handler({ command: " npm run job ", names: ["DATABASE_URL", "DATABASE_URL"] });
    expect(sent()).toEqual({
      url: "http://127.0.0.1:4567/secrets/run",
      body: { ...cardProof(card, "/secrets/run"), folder: proj, cwd: proj, command: "npm run job", argv: ["npm", "run", "job"], env: {}, names: ["DATABASE_URL"], environment: "development", script: "job: node job.js", timeoutMs: 120_000 },
    });
    expect(r.isError).toBe(false);
    expect(said(r)).toBe("npm run job exited with code 0 after 1.2s (secrets from the o/r vault shown as ‹NAME›):\nconnected to ‹DATABASE_URL›");
    expect(sr.usesSecrets(card!)).toBe(true);
  });

  it("sends the card's title and the thread's reason for the approval", async () => {
    const titled = sr.runTool(() => card, () => proj, () => "Email forwarding") as unknown as { handler: Handler };
    reply({ exitCode: 0, output: "" });
    await titled.handler({ command: "node x.js", why: "  Send a test email ", names: ["K"] });
    expect(sent().body).toMatchObject({ thread: "Email forwarding", why: "Send a test email" });
  });

  it("passes environment, cwd, project and a clamped timeout", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "weft-run-"));
    fs.mkdirSync(path.join(other, "sub"));
    reply({ exitCode: 2, output: "", truncated: false });
    const r = await run.handler({ command: "node x.js", names: ["K"], environment: "production", cwd: "sub", timeout_seconds: 9999, project: other });
    expect(sent().body).toMatchObject({ folder: other, cwd: path.join(other, "sub"), environment: "production", timeoutMs: 600_000 });
    expect(sent().body.script).toBeUndefined();
    expect(r.isError).toBe(true);
    expect(said(r)).toBe("node x.js exited with code 2 after 0.0s (secrets from the this vault shown as ‹NAME›):\n(no output)");
    fetchMock.mockReset();
    reply({ exitCode: 0, output: "x" });
    await run.handler({ command: "node x.js", names: ["K"], timeout_seconds: 0 });
    expect(sent().body.timeoutMs).toBe(1000);
  });

  it("says when output was cut, it timed out, or a signal ended it", async () => {
    reply({ label: "o/r", timedOut: true, signal: "SIGTERM", output: "tail", truncated: true, ms: 5000 });
    const r = await run.handler({ command: "node x.js", names: ["K"] });
    expect([r.isError, said(r)]).toEqual([true, "node x.js timed out and was stopped after 5.0s (secrets from the o/r vault shown as ‹NAME›):\n(earlier output cut)\ntail"]);
    reply({ label: "o/r", signal: "SIGKILL", exitCode: null, output: "" });
    expect(said(await run.handler({ command: "node x.js", names: ["K"] }))).toContain("was killed by SIGKILL");
  });

  it("explains a denial or missing names, without marking the card", async () => {
    reply({ denied: true, label: "o/r" });
    const r = await run.handler({ command: "npm run job", names: ["K"] });
    expect([r.isError, said(r)]).toEqual([true, "The user didn't approve running npm run job with secrets. Ask before trying again."]);
    // Missing names go in as blanks, and the thread is told ask_add asks for them in the thread; if main can't be
    // reached, it's told where the user adds them.
    reply({ missing: ["A"], label: "o/r" });
    reply({ added: true });
    expect(said(await run.handler({ command: "npm run job", names: ["A"], environment: "preview" }))).toBe(
      "A has no value in the o/r vault (preview). It's a blank there now. If you're blocked on it, call mcp__secrets__ask_add for A and end your turn: the user gets an input for it in this thread and tells you once it's in.",
    );
    expect(sent(2)).toEqual({ url: "http://127.0.0.1:4567/secrets/ask-add", body: { folder: proj, name: "A", environment: "preview" } });
    reply({ missing: ["A", "B"] });
    reply({ added: true });
    reply({ added: true });
    expect(said(await run.handler({ command: "npm run job", names: ["A", "B"] }))).toMatch(/They're blanks there now\. .*ask_add for each/);
    reply({ missing: ["A", "B"] });
    reply({ error: "no board" }, false);
    reply({ added: true });
    expect(said(await run.handler({ command: "npm run job", names: ["A", "B"] }))).toBe(
      "A, B have no value in the this vault (development). Ask the user to add them with 🔐 on the left rail.",
    );
    expect(sr.usesSecrets(card!)).toBe(false);
  });

  it("refuses bad commands, names and folders before asking main", async () => {
    expect(said(await run.handler({ command: "curl x", names: ["K"] }))).toMatch(/off the machine/);
    expect(said(await run.handler({ command: "npm run job", names: [] }))).toMatch(/at least one/);
    expect(said(await run.handler({ command: "npm run job", names: ["K"], cwd: "../.." }))).toMatch(/outside the project/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("works for a spare with no card yet, without marking anything", async () => {
    card = undefined;
    reply({ exitCode: 0, output: "ok" });
    await run.handler({ command: "npm run job", names: ["K"] });
    // A spare with no card has nothing to prove, so it sends no card at all.
    expect(sent().body.card).toBeUndefined();
    expect(sent().body.cardSig).toBeUndefined();
  });
});

describe("redactStored", () => {
  it("leaves cards that never used secrets alone, and asks main for the rest", async () => {
    expect(await sr.redactStored(card!, "plain")).toBe("plain");
    sr.markInUse(card);
    sr.markInUse(undefined);
    expect(await sr.redactStored(card!, "")).toBe("");
    reply({ text: "pw ‹P›" });
    expect(await sr.redactStored(card!, "pw hunter22")).toBe("pw ‹P›");
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/secrets/redact", body: { ...cardProof(card, "/secrets/redact"), text: "pw hunter22" } });
  });

  it("holds the text back when main can't check it", async () => {
    sr.markInUse(card);
    reply({ error: "down" }, false);
    expect(await sr.redactStored(card!, "pw hunter22")).toMatch(/output hidden/);
  });
});

describe("devSecrets", () => {
  it("gets a one-time grant and a launch through electron/secret-env.cjs", async () => {
    reply({ grant: "g1", names: ["DATABASE_URL"], node: "/Electron", runner: "/app/electron/secret-env.cjs" });
    const r = await sr.devSecrets(card!, "PORT=3001 npm run job", proj);
    expect(sent()).toEqual({
      url: "http://127.0.0.1:4567/secrets/dev-grant",
      body: { ...cardProof(card, "/secrets/dev-grant"), folder: proj, cwd: proj, command: "PORT=3001 npm run job", argv: ["npm", "run", "job"], env: { PORT: "3001" }, script: "job: node job.js" },
    });
    expect(r).toEqual({
      launch: {
        bin: "/Electron",
        args: ["/app/electron/secret-env.cjs"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        stdin: JSON.stringify({ url: "http://127.0.0.1:4567", token: "tok", grant: "g1", argv: ["npm", "run", "job"], env: { PORT: "3001" } }),
        names: ["DATABASE_URL"],
      },
    });
    expect(sr.usesSecrets(card!)).toBe(true);
  });

  it("starts the plain way with no vault values, a denial, a refused command or an error", async () => {
    reply({ names: [] });
    expect(await sr.devSecrets(card!, "npm run dev", proj)).toEqual({});
    reply({ names: "nope", grant: "g" });
    expect(await sr.devSecrets(card!, "npm run dev", proj)).toEqual({});
    reply({ denied: true, names: ["A"] });
    expect(await sr.devSecrets(card!, "npm run dev", proj)).toEqual({ note: "Started without vault secrets: not approved." });
    expect((await sr.devSecrets(card!, "npm run dev | tee log", proj)).note).toMatch(/^Started without vault secrets: The command has shell syntax/);
    reply({ error: "The secrets vault isn't ready yet." }, false);
    expect(await sr.devSecrets(card!, "npm run dev", proj)).toEqual({ note: "Started without vault secrets: The secrets vault isn't ready yet." });
    expect(sr.usesSecrets(card!)).toBe(false);
  });

  it("does nothing outside the desktop app", async () => {
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await sr.devSecrets(card!, "npm run dev", proj)).toEqual({});
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
  });
});
