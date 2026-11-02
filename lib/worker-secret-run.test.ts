import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import type { SecretAsk } from "./secret-use";
import { secretUsePurpose } from "./secret-use";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { askMessage } from "./secret-use";
import { deliverSecretUse, openAsk, openAsks } from "./worker-secret-asks";
import { forgetOnTurnEnd, onWorker, redactOnWorker, setSecretLink, workerSecretRun, type RunDeps, type SecretLink, type WorkerRunRequest } from "./worker-secret-run";
import { newSealKeys, open } from "./worker-seal";
import type { DeviceAnswer } from "./worker-registry";

const keys = newSealKeys();
const signer = macSigner();
const macs = memoryMacs([signer.key]);
let clock = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wsr-"));
let n = 0;
let card: string;

const request = (over: Partial<WorkerRunRequest> = {}): WorkerRunRequest => ({ cardId: card, root, cwd: path.join(root, "app"), command: "npm run job", argv: ["npm", "run", "job"], env: {}, names: ["TOKEN"], environment: "development", timeoutMs: 5_000, thread: "T", why: "W", script: "node job.js", ...over });

// The Mac, as the worker sees it: answers in turn to result(), and the sealed answer it sends on "queued".
function mac(answers: Array<DeviceAnswer | null>, values: Record<string, string> | null = { TOKEN: "s3cret-value" }) {
  const asked: SecretAsk[] = [];
  const ask = vi.fn<SecretLink["ask"]>((_card, args) => {
    asked.push(args);
    return Promise.resolve("call-1");
  });
  const cancel = vi.fn<SecretLink["cancel"]>(() => Promise.resolve(true));
  const link: SecretLink = {
    ask,
    result: vi.fn(() => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      const a = asked[0];
      if (next?.status === "done" && (next.result as { queued?: boolean } | null)?.queued && values && a) {
        const p = { v: 1, card, nonce: a.nonce, command: a.command, names: a.names, environment: a.environment, expiresAt: a.expiresAt, values };
        const sealed = cjs.seal(keys.publicKey, JSON.stringify(p), secretUsePurpose(card, a.nonce, a.command));
        // The daemon claims the secret_use a moment later.
        setTimeout(() => deliverSecretUse({ payload: { cardId: card, nonce: a.nonce, sealed, mac: signer.mac(card, a.nonce, sealed) } as never }, (s, purpose) => open(keys, s, purpose), macs, clock), 0);
      }
      return Promise.resolve(next ?? null);
    }),
    cancel,
  };
  return { link, asked, ask, cancel };
}

const deps = (link: SecretLink | null, over: Partial<RunDeps> = {}): Partial<RunDeps> => ({
  link,
  now: () => clock,
  wait: (ms: number) => {
    clock += ms;
    return new Promise((done) => setTimeout(done, 1));
  },
  remote: () => Promise.resolve("git@github.com:aimhuge/weft.git"),
  script: () => "node job.js",
  exec: vi.fn((_req: unknown, label: string) => Promise.resolve({ label, exitCode: 0, signal: null, timedOut: false, output: "ok ‹TOKEN›", truncated: false, ms: 5 })),
  ...over,
});

beforeEach(() => {
  card = `c${++n}`;
  clock = 1_000;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setSecretLink(null);
});

describe("workerSecretRun", () => {
  it("asks the Mac with names only, runs once the sealed values arrive, and keeps them for redaction", async () => {
    const { link, asked } = mac([{ status: "claimed", result: null, error: null }, { status: "done", result: { queued: true, label: "aimhuge/weft" }, error: null }]);
    const d = deps(link);
    const r = await workerSecretRun(request(), d);
    expect(r).toMatchObject({ label: "aimhuge/weft", exitCode: 0, output: "ok ‹TOKEN›" });
    expect(asked[0]).toMatchObject({ command: "npm run job", names: ["TOKEN"], environment: "development", cwd: "app", remote: "git@github.com:aimhuge/weft.git", script: "node job.js", why: "W", thread: "T", timeoutMs: 5_000 });
    expect(asked[0]?.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(asked[0]?.expiresAt).toBe(1_000 + 5 * 60_000);
    expect(JSON.stringify(asked)).not.toContain("s3cret");
    expect(d.exec).toHaveBeenCalledWith({ argv: ["npm", "run", "job"], cwd: path.join(root, "app"), env: {}, values: { TOKEN: "s3cret-value" }, timeoutMs: 5_000 }, "aimhuge/weft");
    expect(await redactOnWorker(card, "it was s3cret-value")).toBe("it was ‹TOKEN›");
    expect(openAsks()).toBe(0);
  });

  it("names the Mac's vault generically when the answer had no label, and says the project's cwd as .", async () => {
    const { link, asked } = mac([{ status: "done", result: { queued: true }, error: null }]);
    const d = deps(link);
    await workerSecretRun(request({ cwd: root }), d);
    expect(asked[0]?.cwd).toBe(".");
    expect(d.exec).toHaveBeenCalledWith(expect.anything(), "your Mac's");
  });

  it("passes a denial and missing names straight back", async () => {
    expect(await workerSecretRun(request(), deps(mac([{ status: "done", result: { denied: true, label: "o/r" }, error: null }]).link))).toEqual({ denied: true, label: "o/r" });
    expect(await workerSecretRun(request(), deps(mac([{ status: "done", result: { missing: ["TOKEN", 3] }, error: null }]).link))).toEqual({ missing: ["TOKEN"], label: undefined });
    expect(await workerSecretRun(request(), deps(mac([{ status: "done", result: null, error: null }]).link))).toEqual({ denied: true, label: undefined });
    expect(openAsks()).toBe(0);
  });

  it("says what the Mac said when it failed, or that the row went", async () => {
    await expect(workerSecretRun(request(), deps(mac([{ status: "failed", result: null, error: "Sign in to Weft on this Mac" }]).link))).rejects.toThrow("Sign in to Weft on this Mac");
    await expect(workerSecretRun(request(), deps(mac([{ status: "failed", result: null, error: null }]).link))).rejects.toThrow("The Mac couldn't answer.");
    await expect(workerSecretRun(request(), deps(mac([null]).link))).rejects.toThrow("The Mac dropped the request.");
  });

  it("takes the ask back when no Mac claims it, and waits on when the take-back loses to a claim", async () => {
    const { link, cancel } = mac([{ status: "pending", result: null, error: null }]);
    await expect(workerSecretRun(request(), deps(link))).rejects.toThrow(/No Mac with Weft open/);
    expect(cancel).toHaveBeenCalledWith("call-1");
    const late = mac([{ status: "pending", result: null, error: null }]);
    late.cancel.mockResolvedValue(false);
    await expect(workerSecretRun(request(), deps(late.link))).rejects.toThrow(/within 5 minutes/);
  });

  it("gives up at the expiry, taking back an unanswered ask but not a queued one", async () => {
    const claimed = mac([{ status: "claimed", result: null, error: null }]);
    claimed.cancel.mockRejectedValue(new Error("offline"));
    await expect(workerSecretRun(request(), deps(claimed.link))).rejects.toThrow(/Nobody approved the secrets on the Mac within 5 minutes/);
    expect(claimed.cancel).toHaveBeenCalled();
    const queued = mac([{ status: "done", result: { queued: true }, error: null }], null);
    queued.cancel.mockRejectedValue(new Error("down"));
    await expect(workerSecretRun(request(), deps(queued.link))).rejects.toThrow(/within 5 minutes/);
    expect(queued.cancel).not.toHaveBeenCalled();
  });

  it("says when the sealed answer came too late", async () => {
    const { link, asked } = mac([{ status: "claimed", result: null, error: null }], null);
    const d = deps(link, {
      wait: () => {
        const a = asked[0];
        if (a) {
          const p = { v: 1, card, nonce: a.nonce, command: a.command, names: a.names, environment: a.environment, expiresAt: a.expiresAt, values: { TOKEN: "v" } };
          const sealed = cjs.seal(keys.publicKey, JSON.stringify(p), secretUsePurpose(card, a.nonce, a.command));
          expect(() => deliverSecretUse({ payload: { cardId: card, nonce: a.nonce, sealed, mac: signer.mac(card, a.nonce, sealed) } as never }, (s, purpose) => open(keys, s, purpose), macs, a.expiresAt + 1)).toThrow();
        }
        return new Promise((done) => setTimeout(done, 1));
      },
    });
    await expect(workerSecretRun(request(), d)).rejects.toThrow("The approval came too late");
  });

  it("refuses without a card, a link to the Mac, a git remote, or a live Mac", async () => {
    const { link, ask } = mac([]);
    await expect(workerSecretRun(request({ cardId: undefined }), deps(link))).rejects.toThrow("Only a card's thread");
    await expect(workerSecretRun(request(), deps(null))).rejects.toThrow("can't reach your Mac");
    await expect(workerSecretRun(request(), deps(link, { remote: () => Promise.resolve(null) }))).rejects.toThrow("no git remote");
    ask.mockResolvedValueOnce(null);
    await expect(workerSecretRun(request(), deps(link))).rejects.toThrow(/No Mac with Weft open/);
    expect(openAsks()).toBe(0);
  });
});

describe("the defaults", () => {
  it("uses the link the daemon set, reads the checkout's origin, and runs with no shell, redacted", async () => {
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://github.com/aimhuge/weft.git"]);
    const { link, asked } = mac([{ status: "claimed", result: null, error: null }, { status: "done", result: { queued: true, label: "aimhuge/weft" }, error: null }], { TOKEN: "s3cret-value" });
    setSecretLink(link);
    const argv = [process.execPath, "-e", "console.log('got ' + process.env.TOKEN + ' ' + (process.env.FOO || ''))"];
    const r = await workerSecretRun(request({ cwd: root, command: "node job", argv, env: { FOO: "bar" }, script: undefined }));
    expect(asked[0]?.remote).toBe("https://github.com/aimhuge/weft.git");
    expect(r).toMatchObject({ label: "aimhuge/weft", exitCode: 0, output: "got ‹TOKEN› bar\n" });
  });

  it("reads no remote from a folder that isn't a checkout", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wsr-bare-"));
    const { link } = mac([]);
    setSecretLink(link);
    await expect(workerSecretRun(request({ root: bare, cwd: bare }))).rejects.toThrow("no git remote");
  });
});

describe("the review's limits", () => {
  it("signs the ask with the pairing key when the box has one", async () => {
    const { link, asked } = mac([{ status: "done", result: { denied: true }, error: null }]);
    link.sign = (message: string) => `signed:${message.length}`;
    await workerSecretRun(request(), deps(link));
    const [a] = asked;
    if (!a) throw new Error("no ask");
    expect(a.sig).toBe(`signed:${askMessage(card, a).length}`);
    const plain = mac([{ status: "done", result: { denied: true }, error: null }]);
    await workerSecretRun(request(), deps(plain.link));
    expect(plain.asked[0]?.sig).toBeUndefined();
  });

  it("doesn't run when package.json's script changed after the ask", async () => {
    const { link } = mac([{ status: "done", result: { queued: true }, error: null }]);
    const d = deps(link, { script: () => "node evil.js" });
    await expect(workerSecretRun(request(), d)).rejects.toThrow("The package.json script this runs changed after you asked");
    expect(d.exec).not.toHaveBeenCalled();
  });

  it("refuses a script with a bidi or zero-width character before asking the Mac", async () => {
    const { link, ask } = mac([]);
    await expect(workerSecretRun(request({ script: "job: node job.js\u202e" }), deps(link))).rejects.toThrow("control or invisible characters");
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks once per card at a time", async () => {
    const held = openAsk("d".repeat(64), { cardId: card, command: "x", names: ["TOKEN"], environment: "development", expiresAt: clock + 1 });
    const { link, ask } = mac([]);
    await expect(workerSecretRun(request(), deps(link))).rejects.toThrow("This card already has a secret ask waiting");
    expect(ask).not.toHaveBeenCalled();
    held.drop();
  });

  it("forgets a card's values when its turn ends or the card goes", async () => {
    const { link } = mac([{ status: "done", result: { queued: true }, error: null }]);
    await workerSecretRun(request(), deps(link));
    forgetOnTurnEnd({ type: "card", card: { id: card, column: "running" } } as never);
    expect(await redactOnWorker(card, "s3cret-value")).toBe("‹TOKEN›");
    forgetOnTurnEnd({ type: "card", card: { id: card, column: "review" } } as never);
    expect(await redactOnWorker(card, "s3cret-value")).toBe("s3cret-value");
    const other = mac([{ status: "done", result: { queued: true }, error: null }]);
    card = `${card}-b`;
    await workerSecretRun(request(), deps(other.link));
    forgetOnTurnEnd({ type: "thread_cleared", cardId: card } as never);
    expect(await redactOnWorker(card, "s3cret-value")).toBe("‹TOKEN›");
    forgetOnTurnEnd({ type: "card_deleted", id: card } as never);
    expect(await redactOnWorker(card, "s3cret-value")).toBe("s3cret-value");
  });
});

describe("onWorker and redactOnWorker", () => {
  it("is a worker card with no control server", () => {
    vi.stubEnv("WEFT_WORKER", "1");
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(onWorker()).toBe(true);
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:1");
    expect(onWorker()).toBe(false);
    vi.stubEnv("WEFT_WORKER", "");
    expect(onWorker()).toBe(false);
  });

  it("leaves a card that used no secrets alone", async () => {
    expect(await redactOnWorker("never", "plain")).toBe("plain");
  });
});
