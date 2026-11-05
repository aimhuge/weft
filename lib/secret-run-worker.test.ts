// mcp__secrets__run on a Weft Worker (lib/secret-run.ts → lib/worker-secret-run.ts): no control server, so the run asks
// the owner's Mac instead of main, and stored text is redacted from the values this process kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));
const workerSecretRun = vi.hoisted(() => vi.fn());
const redactOnWorker = vi.hoisted(() => vi.fn((_card: string, text: string) => Promise.resolve(text.replace("s3cret", "‹K›"))));
vi.mock("./worker-secret-run", () => ({ onWorker: () => true, workerSecretRun, redactOnWorker }));
const devEnvOnWorker = vi.hoisted(() => vi.fn());
vi.mock("./worker-dev-env", () => ({ devEnvOnWorker }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

const sr = await import("./secret-run");

const proj = fs.mkdtempSync(path.join(os.tmpdir(), "weft-run-worker-"));
fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { job: "node job.js" } }));
const run = sr.runTool(() => "w1", () => proj, () => "Deploy") as unknown as { handler: Handler };

describe("runTool on a worker", () => {
  it("asks through the worker's link, not main, and reports the redacted run", async () => {
    workerSecretRun.mockResolvedValueOnce({ label: "aimhuge/weft", exitCode: 0, signal: null, timedOut: false, output: "ok ‹K›", truncated: false, ms: 300 });
    const r = await run.handler({ command: "npm run job", why: "Ship it", names: ["K"] });
    expect(workerSecretRun).toHaveBeenCalledWith({ cardId: "w1", root: proj, thread: "Deploy", why: "Ship it", cwd: proj, command: "npm run job", argv: ["npm", "run", "job"], env: {}, names: ["K"], environment: "development", script: "job: node job.js", timeoutMs: 120_000 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.content[0]?.text).toBe("npm run job exited with code 0 after 0.3s (secrets from the aimhuge/weft vault shown as ‹NAME›):\nok ‹K›");
    expect(sr.usesSecrets("w1")).toBe(true);
  });

  it("says a denial from the Mac, and an error when the Mac can't be reached", async () => {
    workerSecretRun.mockResolvedValueOnce({ denied: true, label: "aimhuge/weft" });
    expect((await run.handler({ command: "npm run job", names: ["K"] })).content[0]?.text).toMatch(/didn't approve/);
    workerSecretRun.mockRejectedValueOnce(new Error("No Mac with Weft open is signed in"));
    const r = await run.handler({ command: "npm run job", names: ["K"] });
    expect(r).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("No Mac with Weft open") as unknown }] });
  });
});

describe("redactStored on a worker", () => {
  it("redacts from the values this process kept, never asking main", async () => {
    sr.markInUse("w2");
    expect(await sr.redactStored("w2", "it is s3cret")).toBe("it is ‹K›");
    expect(redactOnWorker).toHaveBeenCalledWith("w2", "it is s3cret");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("devSecrets on a worker", () => {
  it("asks the Mac through lib/worker-dev-env.ts, not main, and marks the card as using secrets", async () => {
    const launch = { bin: "node", args: ["secret-env.cjs"], env: {}, stdin: "{}", names: ["K"] };
    devEnvOnWorker.mockResolvedValueOnce({ launch });
    expect(await sr.devSecrets("w3", "pnpm dev", proj, "Fix")).toEqual({ launch });
    expect(devEnvOnWorker).toHaveBeenCalledWith({ cardId: "w3", thread: "Fix", root: proj, cwd: proj, command: "pnpm dev", argv: ["pnpm", "dev"], env: {}, script: undefined });
    expect(sr.usesSecrets("w3")).toBe(true);
    devEnvOnWorker.mockResolvedValueOnce({ note: "Started without vault secrets: not approved on your Mac." });
    expect(await sr.devSecrets("w4", "pnpm dev", proj)).toEqual({ note: "Started without vault secrets: not approved on your Mac." });
    expect(sr.usesSecrets("w4")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
