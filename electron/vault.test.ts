import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createUnlock, createVault, parseRemote, registerVault, touchIdPrompt, vaultIdFor, CLIPBOARD_MS, UNLOCK_MS } from "./vault.cjs";

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

function make({ remote = "git@github.com:Owner/Repo.git", tracked = "", allow = true, onChange = undefined as ((folder: string) => undefined) | undefined } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const prompt = vi.fn(() => Promise.resolve(allow));
  let clip = "";
  const clipboard = { writeText: vi.fn((t: string) => (clip = t)), readText: () => clip };
  const timers: (() => void)[] = [];
  const run = vi.fn((_folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? remote : tracked));
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, onChange, setTimer: ((fn: () => void) => timers.push(fn)) as unknown as typeof setTimeout });
  return { vault, dataDir, prompt, clipboard, timers, run, clip: () => clip };
}

describe("parseRemote and vaultIdFor", () => {
  it("names GitHub repos owner/name, other hosts by host and path", () => {
    expect(parseRemote("git@github.com:Owner/Repo.git\n")).toEqual({ id: "github:owner/repo", label: "Owner/Repo" });
    expect(parseRemote("https://github.com/owner/repo")).toEqual({ id: "github:owner/repo", label: "owner/repo" });
    expect(parseRemote("ssh://git@GitLab.com/group/sub/proj.git")).toEqual({ id: "gitlab.com:group/sub/proj", label: "group/sub/proj" });
    expect(parseRemote("nonsense")).toBeNull();
  });

  it("falls back to the folder without a remote", async () => {
    expect(await vaultIdFor("/tmp/some/app", () => Promise.resolve(null))).toEqual({ id: "folder:/tmp/some/app", label: "app" });
    expect(await vaultIdFor("/tmp/x", () => Promise.resolve("nonsense"))).toEqual({ id: "folder:/tmp/x", label: "x" });
  });

  it("asks git for real", async () => {
    const { id } = await vaultIdFor(os.tmpdir());
    expect(id).toMatch(/^folder:|:/);
  });
});

describe("createUnlock", () => {
  it("asks once, stays open while used, then locks when idle or told to", async () => {
    let t = 0;
    const prompt = vi.fn(() => Promise.resolve(true));
    const unlock = createUnlock({ prompt, now: () => t });
    expect(unlock.unlocked()).toBe(false);
    expect(await unlock.ensure("reveal A")).toBe(true);
    t = UNLOCK_MS - 1;
    expect(await unlock.ensure("reveal B")).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    t += UNLOCK_MS + 1;
    expect(unlock.unlocked()).toBe(false);
    unlock.lock();
    prompt.mockResolvedValueOnce(false);
    expect(await unlock.ensure("reveal C")).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("uses the real clock by default", async () => {
    const unlock = createUnlock({ prompt: () => Promise.resolve(true) });
    await unlock.ensure("x");
    expect(unlock.unlocked()).toBe(true);
  });
});

describe("createVault", () => {
  it("shows no vault and a nudge before the first import, without making a key", async () => {
    const folder = project({ ".env.local": `A=${LONG}\nB=two\n` });
    const { vault, dataDir } = make();
    const { vaults, unlocked } = await vault.overview([folder, folder]);
    expect(unlocked).toBe(false);
    expect(vaults).toEqual([{ id: "github:owner/repo", label: "Owner/Repo", folder, folders: [folder, folder], secrets: [], nudge: { count: 2, file: ".env.local", managed: false }, managed: false }]);
    expect(fs.existsSync(path.join(dataDir, "device-key.json"))).toBe(false);
  });

  it("previews an import against the vault, imports picks from disk, and clears the nudge", async () => {
    const folder = project({
      ".env.local": `A=${LONG}\nB=two\nNEXT_PUBLIC_URL=https://example.test\n`,
      ".env": "SHARED=1\n",
      ".env.example": "A=\nNEEDED=\nNEXT_PUBLIC_X=\n",
      ".env.production.local": "# Created by Vercel CLI\nVERCEL_OIDC_TOKEN=xyz\nDB=prod\n",
    });
    const { vault } = make({ tracked: ".env\n" });
    const scan = await vault.scan(folder);
    expect(scan.files).toEqual([
      { file: ".env", environment: "development", namesOnly: false, tracked: true, vercel: false },
      { file: ".env.example", environment: "development", namesOnly: true, tracked: false, vercel: false },
      { file: ".env.local", environment: "development", namesOnly: false, tracked: false, vercel: false },
      { file: ".env.production.local", environment: "production", namesOnly: false, tracked: false, vercel: true },
    ]);
    const row = (name: string) => scan.rows.find((r: { name: string }) => r.name === name);
    expect(row("SHARED")).toMatchObject({ status: "new", ticked: false });
    expect(row("A")).toMatchObject({ file: ".env.local", status: "new", tail: "1111", ticked: true, public: false });
    expect(row("NEEDED")).toMatchObject({ status: "missing", tail: "", ticked: true });
    expect(row("NEXT_PUBLIC_X")).toMatchObject({ status: "missing", public: true });
    expect(row("NEXT_PUBLIC_URL")).toMatchObject({ public: true });
    expect(row("VERCEL_OIDC_TOKEN")).toMatchObject({ skipped: true, ticked: false });
    expect(row("DB")).toMatchObject({ environment: "production", ticked: true });
    expect(scan.rows.filter((r: { name: string }) => r.name === "A")).toHaveLength(1);

    const picks = scan.rows.filter((r: { ticked: boolean }) => r.ticked).map((r: { file: string; name: string }) => ({ file: r.file, name: r.name }));
    expect(await vault.importPicks(folder, [...picks, { file: "../../etc/passwd", name: "root" }])).toEqual({ imported: 6 });
    expect(await vault.importPicks(folder, [])).toEqual({ imported: 0 });

    const { vaults } = await vault.overview([folder]);
    expect(vaults[0]!.nudge).toBeNull();
    expect(vaults[0]!.secrets.map((s: { name: string; environment: string; missing: boolean }) => `${s.environment}/${s.name}${s.missing ? "?" : ""}`).sort()).toEqual([
      "development/A",
      "development/B",
      "development/NEEDED?",
      "development/NEXT_PUBLIC_URL",
      "development/NEXT_PUBLIC_X?",
      "production/DB",
    ]);

    const again = await vault.scan(folder);
    expect(again.rows.find((r: { name: string }) => r.name === "A")).toMatchObject({ status: "same", ticked: false });
    expect(again.rows.find((r: { name: string }) => r.name === "NEEDED")).toBeUndefined();

    fs.writeFileSync(path.join(folder, ".env.local"), `A=changed\nB=two\nNEXT_PUBLIC_URL=https://example.test\n`);
    expect((await vault.scan(folder)).rows.find((r: { name: string }) => r.name === "A")).toMatchObject({ status: "differs", ticked: true });
    expect((await vault.overview([folder])).vaults[0]!.nudge).toEqual({ count: 1, file: ".env.local", managed: false });
  });

  it("scans a project with no .env files without listing every tracked file", async () => {
    const { vault, run } = make({ remote: "" });
    const folder = project({ "README.md": "hi" });
    expect((await vault.scan(folder)).rows).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("asks for Touch ID to reveal or copy, and clears the clipboard later", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt, clip, timers, clipboard } = make();
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    const id = "github:owner/repo";
    expect(await vault.reveal(id, "A", "development")).toEqual({ value: LONG });
    expect(prompt).toHaveBeenCalledWith("reveal A");
    expect(await vault.reveal(id, "NOPE", "development")).toEqual({ missing: true });
    expect(await vault.copy(id, "NOPE", "development")).toEqual({ missing: true });
    expect(await vault.copy(id, "A", "development")).toEqual({ copied: true });
    expect(clip()).toBe(LONG);
    timers[0]!();
    expect(clip()).toBe("");
    await vault.copy(id, "A", "development");
    clipboard.writeText("something else");
    timers[1]!();
    expect(clip()).toBe("something else");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(vault.lock()).toEqual({ unlocked: false });
    prompt.mockResolvedValue(false);
    expect(await vault.reveal(id, "A", "development")).toEqual({ denied: true });
    expect(await vault.copy(id, "A", "development")).toEqual({ denied: true });
    expect(await vault.remove(id, "A", "development")).toEqual({ removed: true });
    expect(CLIPBOARD_MS).toBe(60_000);
  });

  it("gives threads names only, and a value only after a Touch ID per card, site and vault", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const { vault, prompt } = make();
    expect(await vault.names(folder)).toEqual({ label: "Owner/Repo", secrets: [] });
    await vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    await vault.setValue(folder, "B", "production", "short");
    expect(await vault.names(folder)).toEqual({
      label: "Owner/Repo",
      secrets: [
        { name: "A", environment: "development", missing: false },
        { name: "B", environment: "production", missing: false },
      ],
    });

    // The drawer being unlocked doesn't let a thread in.
    await vault.reveal("github:owner/repo", "A", "development");
    prompt.mockClear();
    const site = { card: "c1", site: "supabase.com" };
    expect(await vault.useFor(folder, "A", "development", site)).toEqual({ value: LONG, label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledWith("let a thread type A (Owner/Repo) into supabase.com");
    expect(await vault.useFor(folder, "B", "production", site)).toEqual({ value: "short", label: "Owner/Repo" });
    expect(prompt).toHaveBeenCalledTimes(1);
    await vault.useFor(folder, "A", "development", { card: "c1", site: "evil.test" });
    await vault.useFor(folder, "A", "development", { card: "c2", site: "supabase.com" });
    expect(prompt).toHaveBeenCalledTimes(3);

    expect(await vault.useFor(folder, "NOPE", "development", site)).toEqual({ missing: true, label: "Owner/Repo" });
    vault.lock();
    prompt.mockResolvedValue(false);
    expect(await vault.useFor(folder, "A", "development", site)).toEqual({ denied: true, label: "Owner/Repo" });
  });

  it("keeps a source on a value, and tells the board only when it has one (a pull from Vercel)", async () => {
    const folder = project({ "README.md": "hi" });
    const onChange = vi.fn<(folder: string) => undefined>();
    const { vault } = make({ onChange });
    await vault.setValue(folder, "HAND", "development", "typed");
    expect(onChange).not.toHaveBeenCalled();
    expect(await vault.setValue(folder, "A", "production", "two", { source: "Vercel" })).toEqual({ saved: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(folder);
    const secrets = (await vault.overview([folder])).vaults[0]!.secrets as { name: string; environment: string; source?: string }[];
    expect(secrets.find((s) => s.name === "A")).toMatchObject({ environment: "production", source: "Vercel" });
    expect(secrets.find((s) => s.name === "HAND")?.source).toBeUndefined();
    expect(await vault.valuesFor(folder, ["A"], "production")).toMatchObject({ values: { A: "two" } });
  });

  it("hands main the values a command asked for, or every development value for a dev server", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault, prompt } = make();
    expect(await vault.valuesFor(folder, null, "development")).toEqual({ id: "github:owner/repo", label: "Owner/Repo", values: {}, missing: [] });
    expect(await vault.valuesFor(folder, ["A"], "development")).toEqual({ id: "github:owner/repo", label: "Owner/Repo", values: {}, missing: ["A"] });
    await vault.setValue(folder, "A", "development", LONG);
    await vault.setValue(folder, "B", "production", "prod-only");
    await vault.importPicks(project({ ".env.example": "EMPTY=\n" }), []);
    expect(await vault.valuesFor(folder, null, "development")).toMatchObject({ values: { A: LONG }, missing: [] });
    expect(await vault.valuesFor(folder, ["A", "B"], "development")).toMatchObject({ values: { A: LONG }, missing: ["B"] });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("tells a thread a vault that doesn't exist yet has nothing in it", async () => {
    const other = make({ remote: "git@github.com:Owner/Other.git" });
    expect(await other.vault.useFor(project({}), "A", "development", { card: "c1", site: "a.test" })).toEqual({ missing: true, label: "Owner/Other" });
  });

  it("adds and changes secrets by hand in a project with no .env file", async () => {
    const folder = project({ "README.md": "hi" });
    const { vault } = make();
    await expect(vault.setValue(folder, "1BAD", "development", "x")).rejects.toThrow(/isn't a variable name/);
    await expect(vault.setValue(folder, "", "development", "x")).rejects.toThrow(/A blank name/);
    await expect(vault.setValue(folder, "A", "development", "")).rejects.toThrow(/Type a value for A/);
    await expect(vault.setValue(folder, "A", "staging", "x")).rejects.toThrow(/Unknown environment/);
    expect(await vault.setValue(folder, "A", "production", LONG)).toEqual({ saved: true });
    expect((await vault.overview([folder])).vaults[0]).toMatchObject({ label: "Owner/Repo", nudge: null, secrets: [{ name: "A", environment: "production", tail: "1111", missing: false }] });
    await vault.setValue(folder, "A", "production", "changed-value-2222");
    expect(await vault.reveal("github:owner/repo", "A", "production")).toEqual({ value: "changed-value-2222" });
  });

  it("copies a secret into another project's vault, values staying in main", async () => {
    const one = project({ ".env.example": "NEEDED=\n" });
    const two = project({});
    const remotes = new Map([
      [one, "git@github.com:o/one.git"],
      [two, "git@github.com:o/two.git"],
    ]);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
    const run = (folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? (remotes.get(folder) ?? "") : "");
    const vault = createVault({ dataDir, safeStorage, sodium, prompt: () => Promise.resolve(true), clipboard: { writeText: () => {}, readText: () => "" }, run });
    await vault.setValue(one, "A", "development", LONG);
    await vault.importPicks(one, [{ file: ".env.example", name: "NEEDED" }]);

    expect(await vault.copyTo("github:o/one", "NOPE", "development", two)).toEqual({ missing: true });
    await expect(vault.copyTo("github:o/one", "A", "development", one)).rejects.toThrow(/A is already in o\/one/);
    expect(await vault.copyTo("github:o/one", "A", "development", two)).toEqual({ copied: true, label: "o/two", replaced: false });
    expect(await vault.copyTo("github:o/one", "A", "development", two)).toEqual({ copied: true, label: "o/two", replaced: true });
    expect(await vault.copyTo("github:o/one", "NEEDED", "development", two)).toEqual({ copied: true, label: "o/two", replaced: false });
    expect(await vault.reveal("github:o/two", "A", "development")).toEqual({ value: LONG });
    const { vaults } = await vault.overview([two]);
    expect(vaults[0]!.secrets.map((s: { name: string; missing: boolean }) => `${s.name}${s.missing ? "?" : ""}`).sort()).toEqual(["A", "NEEDED?"]);
  });

  it("opens the vault on the next launch from the files on disk", async () => {
    const folder = project({ ".env.local": `A=${LONG}\n` });
    const first = make();
    await first.vault.importPicks(folder, [{ file: ".env.local", name: "A" }]);
    const vault = createVault({ dataDir: first.dataDir, safeStorage, sodium, prompt: () => Promise.resolve(true), clipboard: first.clipboard, run: first.run });
    expect((await vault.overview([folder])).vaults[0]!.secrets[0]).toMatchObject({ name: "A", tail: "1111" });
  });
});

describe("registerVault", () => {
  it("answers the board window and refuses everyone else", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const board = {};
    const vault = {
      overview: vi.fn((f: unknown) => Promise.resolve(f)),
      scan: vi.fn((f: unknown) => Promise.resolve(f)),
      importPicks: vi.fn((f: unknown, p: unknown) => Promise.resolve([f, p])),
      reveal: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      copy: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      setValue: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      copyTo: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      remove: vi.fn((...a: unknown[]) => Promise.resolve(a)),
      lock: vi.fn(() => "locked"),
    };
    registerVault(ipcMain, { vault, isBoard: (sender: unknown) => sender === board });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);
    await expect(handlers.get("vault:overview")!({ sender: {} }, ["/a"])).rejects.toThrow(/board window/);
    expect(await call("vault:overview", ["/a", 3])).toEqual(["/a"]);
    expect(await call("vault:overview", "nope")).toEqual([]);
    expect(await call("vault:scan", "/a")).toBe("/a");
    expect(await call("vault:import", "/a", [{ file: ".env", name: "A" }])).toEqual(["/a", [{ file: ".env", name: "A" }]]);
    expect(await call("vault:import", "/a", "x")).toEqual(["/a", []]);
    expect(await call("vault:reveal", "v", "A", "development")).toEqual(["v", "A", "development"]);
    expect(await call("vault:copy", "v", "A", "development")).toEqual(["v", "A", "development"]);
    expect(await call("vault:set", "/a", "A", "development", "x")).toEqual(["/a", "A", "development", "x"]);
    expect(await call("vault:set", "/a", "A", "development")).toEqual(["/a", "A", "development", ""]);
    expect(await call("vault:copy-to", "v", "A", "development", "/b")).toEqual(["v", "A", "development", "/b"]);
    expect(await call("vault:remove", "v", "A", "development")).toEqual(["v", "A", "development"]);
    expect(await call("vault:lock")).toBe("locked");
  });
});

describe("touchIdPrompt", () => {
  const dialog = (response: number) => ({ showMessageBox: vi.fn(() => Promise.resolve({ response })) });

  it("uses Touch ID when it can, and treats a cancel as no", async () => {
    const systemPreferences = { canPromptTouchID: () => true, promptTouchID: vi.fn(() => Promise.resolve(undefined)) };
    expect(await touchIdPrompt({ systemPreferences, dialog: dialog(0), window: () => undefined })("reveal A")).toBe(true);
    expect(systemPreferences.promptTouchID).toHaveBeenCalledWith("reveal A");
    systemPreferences.promptTouchID.mockRejectedValueOnce(new Error("cancelled"));
    expect(await touchIdPrompt({ systemPreferences, dialog: dialog(0), window: () => undefined })("reveal A")).toBe(false);
  });

  it("falls back to a confirmation without Touch ID", async () => {
    expect(await touchIdPrompt({ systemPreferences: {}, dialog: dialog(1), window: () => undefined })("copy A")).toBe(true);
    expect(await touchIdPrompt({ systemPreferences: { canPromptTouchID: () => false }, dialog: dialog(0), window: () => undefined })("copy A")).toBe(false);
  });
});
