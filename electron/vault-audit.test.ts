import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault, registerVault } from "./vault.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const LONG = "sk_test_aaaaaaaaaaaa1111"; // gitleaks:allow

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

function make({
  remote = "git@github.com:Owner/Repo.git",
  tracked = "",
  allow = true,
  onChange = undefined as ((folder: string) => undefined) | undefined,
  audit = undefined as ((entry: Record<string, unknown>) => unknown) | undefined,
} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const prompt = vi.fn(() => Promise.resolve(allow));
  let clip = "";
  const clipboard = { writeText: vi.fn((t: string) => (clip = t)), readText: () => clip };
  const timers: (() => void)[] = [];
  const run = vi.fn((_folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? remote : tracked));
  const auditFn = audit ?? vi.fn();
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, onChange, audit: auditFn, setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout });
  return { vault, dataDir, prompt, clipboard, timers, run, clip: () => clip, audit: auditFn as ReturnType<typeof vi.fn> };
}

// The audit lines a vault wrote, newest last.
const lines = (audit: ReturnType<typeof vi.fn>) => audit.mock.calls.map((c) => c[0] as Record<string, unknown>);

// The vault's audit lines (electron/keychain-audit.cjs) and thread grants (electron/vault-grants.cjs).
describe("createVault audit and grants", () => {
  it("audits reveals and copies, with a denied line when the prompt says no", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt, audit } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    const id = "github:owner/repo";

    expect(await vault.reveal(id, "A", "development")).toEqual({ value: LONG });
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "reveal", by: "you", names: ["A"], outcome: "ok" }));

    expect(await vault.copy(id, "A", "development")).toEqual({ copied: true });
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "copy", by: "you", names: ["A"], outcome: "ok" }));

    prompt.mockResolvedValue(false);
    vault.lock();
    expect(await vault.reveal(id, "A", "development")).toEqual({ denied: true });
    expect(await vault.copy(id, "A", "development")).toEqual({ denied: true });
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "reveal", by: "you", names: ["A"], outcome: "denied" }));
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "copy", by: "you", names: ["A"], outcome: "denied" }));
  });

  it("uses a live grant without asking again, and audits it as via grant", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt, audit } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    // The grant names the site it covers, so it may fill that page without asking again.
    expect(await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", site: "supabase.com" })).toMatchObject({ granted: true });
    prompt.mockClear();

    const got = await vault.useFor(folder, "A", "development", { card: "c1", site: "supabase.com", thread: "Build card" });
    expect(got).toEqual({ value: LONG, label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "fill", by: "thread", card: "c1", via: "grant", outcome: "ok" }));
  });

  it("audits a thread's first fill as touch-id and a later one as unlocked", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, audit } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    const where = { card: "c1", site: "supabase.com", thread: "Build card" };
    await vault.useFor(folder, "A", "development", where);
    await vault.useFor(folder, "A", "development", where);
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "fill", card: "c1", via: "touch-id", outcome: "ok" }));
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "fill", card: "c1", via: "unlocked", outcome: "ok" }));
  });

  it("audits sending a value, allowed or denied", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt, audit } = make();
    await vault.setValue(folder, "A", "development", "value");

    prompt.mockResolvedValueOnce(false);
    expect(await vault.sendValue(folder, "A", "development", (label: string) => `send ${label}`, () => Promise.resolve({ sent: true }))).toEqual({ denied: true, label: "Owner/Repo" });
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "send", by: "weft", names: ["A"], outcome: "denied" }));

    expect(await vault.sendValue(folder, "A", "development", (label: string) => `send ${label}`, () => Promise.resolve({ sent: true }))).toEqual({ sent: true, label: "Owner/Repo" });
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "send", by: "weft", names: ["A"], outcome: "ok" }));
  });

  it("audits a read by default, but not when the caller writes its own line", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, audit } = make();
    await vault.setValue(folder, "A", "development", "value");
    await vault.valuesFor(folder, ["A"], "development");
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "read", by: "weft", names: ["A"], outcome: "ok" }));

    const before = audit.mock.calls.length;
    await vault.valuesFor(folder, ["A"], "development", false);
    expect(audit.mock.calls.length).toBe(before);
    expect(lines(audit).filter((l) => l.action === "read")).toHaveLength(1);
  });

  it("audits a refused confirmation, but not an allowed one", async () => {
    const { vault, prompt, audit } = make();
    prompt.mockResolvedValueOnce(false);
    expect(await vault.confirm("let a thread set A")).toBe(false);
    expect(lines(audit)).toContainEqual(expect.objectContaining({ kind: "vault", action: "ask", by: "weft", outcome: "denied" }));

    const before = audit.mock.calls.length;
    expect(await vault.confirm("let a thread set B")).toBe(true);
    expect(audit.mock.calls.length).toBe(before);
  });

  it("audits vault writes and imports with their own actions", async () => {
    const one = project({ ".env.local": `A=${LONG}\n` });
    const two = project({ "README.md": "hi" });
    const { vault, audit } = make();
    await vault.importPicks(one, [{ file: ".env.local", name: "A" }]);
    await vault.setValue(two, "B", "development", "value");
    await vault.addBlanks(two, ["C"], ["development"], { source: "a thread" });
    await vault.remove("github:owner/repo", "B", "development");

    // A second project, so copyTo has somewhere else to put the value.
    const remotes = new Map([
      [one, "git@github.com:o/one.git"],
      [two, "git@github.com:o/two.git"],
    ]);
    const other = make({ remote: "" });
    other.run.mockImplementation((folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? (remotes.get(folder) ?? "") : ""));
    await other.vault.setValue(one, "D", "development", "other-value");
    await other.vault.copyTo("github:o/one", "D", "development", two);

    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "import", names: ["A"], outcome: "ok" }));
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "set", names: ["B"], outcome: "ok" }));
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "add blank", names: ["C"], outcome: "ok" }));
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "remove", names: ["B"], outcome: "ok" }));
    expect(lines(other.audit)).toContainEqual(expect.objectContaining({ action: "copy to", names: ["D"], outcome: "ok" }));
  });

  it("keeps grants when the drawer locks, and lists and revokes them", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt, audit } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    expect(await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", site: "supabase.com" })).toMatchObject({ granted: true });
    expect(vault.grantList()).toEqual([expect.objectContaining({ card: "c1", thread: "Build card", label: "Owner/Repo" })]);

    vault.lock();
    prompt.mockClear();
    expect(await vault.useFor(folder, "A", "development", { card: "c1", site: "supabase.com" })).toEqual({ value: LONG, label: "Owner/Repo" });
    expect(prompt).not.toHaveBeenCalled();

    expect(vault.revoke("c1")).toEqual({ revoked: 1 });
    expect(vault.grantList()).toEqual([]);
    expect(lines(audit)).toContainEqual(expect.objectContaining({ action: "revoke", by: "you", card: "c1" }));
  });

  // A grant is never wider than the approval the user read. A grant that names one site may not
  // fill another page, and a grant with no site at all says nothing about where a value may be
  // typed, so it never covers a fill (2026-10-28).
  it("does not let a grant for one site cover another", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    expect(await vault.grant(folder, { card: "c1", thread: "Build card", by: "you", site: "supabase.com" })).toMatchObject({ granted: true });
    prompt.mockClear();

    // Another site: the grant does not cover it, so it asks. The user says no, which is what
    // proves the grant didn't cover it (a grant would have typed the value with no question).
    prompt.mockResolvedValue(false);
    const other = await vault.useFor(folder, "A", "development", { card: "c1", site: "evil.example.com" });
    expect(other).toEqual({ denied: true, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("does not let a grant with no site cover a fill", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    expect(await vault.grant(folder, { card: "c1", thread: "Build card", by: "you" })).toMatchObject({ granted: true });
    prompt.mockClear();

    // The grant names no page, so it covers only the site-less powers: a fill still asks.
    prompt.mockResolvedValue(false);
    const got = await vault.useFor(folder, "A", "development", { card: "c1", site: "supabase.com" });
    expect(got).toEqual({ denied: true, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

describe("registerVault grants and activity", () => {
  it("registers the grant and activity channels", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const board = {};
    const vault = {
      grantList: vi.fn(() => [{ card: "c1", id: "github:o/r", label: "o/r" }]),
      grant: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      revoke: vi.fn((card: string, id: string | undefined) => ({ revoked: 1, card, id })),
    };
    registerVault(ipcMain, { vault, isBoard: (sender: unknown) => sender === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);

    expect(handlers.has("vault:grants")).toBe(true);
    expect(handlers.has("vault:grant")).toBe(true);
    expect(handlers.has("vault:revoke")).toBe(true);
    expect(handlers.has("vault:activity")).toBe(true);

    expect(await call("vault:grants")).toEqual([{ card: "c1", id: "github:o/r", label: "o/r" }]);
    expect(await call("vault:grant", "/proj", "c1", "Build card")).toEqual(["/proj", { card: "c1", thread: "Build card", by: "you" }]);
    expect(await call("vault:revoke", "c1", "github:o/r")).toEqual({ revoked: 1, card: "c1", id: "github:o/r" });
    expect(await call("vault:revoke", "c1")).toEqual({ revoked: 1, card: "c1", id: undefined });

    const activity = (await call("vault:activity", 10)) as { entries: unknown; waiting: number; syncedAt: string | null };
    expect(Array.isArray(activity.entries)).toBe(true);
    expect(activity).toHaveProperty("waiting");
    expect(activity).toHaveProperty("syncedAt");
  });
});
