import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { g, load, settingsDir, withSettingsDir } from "./settings.harness";

// The worktree pool (how many ready worktrees are kept per recently isolated repo) and the
// backup model (the banner's rerun). Both go through the readSetting/writeSetting pair, so this
// file also covers the invalid-value fallbacks and the "stored as unset when it is the default"
// write path the older settings.test.ts leaves alone.

withSettingsDir();

describe("the worktree pool", () => {
  it("keeps one ready worktree per repo until it is set", async () => {
    const s = await load();
    expect(s.worktreePoolSize()).toBe(1);
    expect(s.settingsView().projects).toEqual([]);
  });

  it("clamps the pool to 0..3 and rounds", async () => {
    const s = await load();
    s.setWorktreePoolSize(2);
    expect(s.worktreePoolSize()).toBe(2);
    s.setWorktreePoolSize(9);
    expect(s.worktreePoolSize()).toBe(3);
    s.setWorktreePoolSize(-4);
    expect(s.worktreePoolSize()).toBe(0);
    s.setWorktreePoolSize(1.6);
    expect(s.worktreePoolSize()).toBe(2);
  });

  it("stores the pool as unset when it is back at one", async () => {
    const s = await load();
    s.setWorktreePoolSize(3);
    s.setWorktreePoolSize(1);
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("worktreePool" in saved).toBe(false);
  });

  it("keeps a pool of zero, which turns the pool off", async () => {
    let s = await load();
    s.setWorktreePoolSize(0);
    s = await load();
    expect(s.worktreePoolSize()).toBe(0);
  });

  it("reads a saved pool that no longer type-checks as the default", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ worktreePool: "three" }));
    expect((await load()).worktreePoolSize()).toBe(1);
  });

  it("reads a saved pool outside the allowed range as the default", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ worktreePool: 9 }));
    expect((await load()).worktreePoolSize()).toBe(1);
  });
});

describe("the backup model", () => {
  it("starts with none, takes any model a CLI serves, and clears on empty", async () => {
    let s = await load();
    expect(s.backupModel()).toBe("");
    expect(s.settingsView().backupModel).toBe("");
    s.setBackupModel("claude-opus-5-5");
    s = await load();
    expect(s.backupModel()).toBe("claude-opus-5-5");
    s.setBackupModel("puku-ai-2.8");
    s = await load();
    expect(s.backupModel()).toBe("puku-ai-2.8");
    s.setBackupModel("");
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("backupModel" in saved).toBe(false);
  });

  it("reads a saved backup model no CLI serves as none", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ backupModel: "gone-1" }));
    expect((await load()).backupModel()).toBe("");
  });
});

describe("settings that read a saved value of the wrong type", () => {
  it("reads a saved Goose model that isn't text as none", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ gooseModelId: 42 }));
    expect((await load()).gooseModelId()).toBe("");
  });

  it("reads a saved Goose endpoint that isn't text as none", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ gooseBaseUrl: { host: "x" } }));
    expect((await load()).gooseBaseUrl()).toBe("");
  });

  it("reads a saved thread cap that isn't a number as the default", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ maxThreads: "6" }));
    expect((await load()).maxThreads()).toBe(6);
  });

  it("reads a saved permission mode that isn't one as auto", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ defaultPermissionMode: "yolo" }));
    expect((await load()).defaultPermissionMode()).toBe("auto");
  });

  it("reads a saved default CLI it doesn't know as claude", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ defaultBackend: "nope" }));
    expect((await load()).defaultBackend()).toBe("nope");
  });

  // The older getters guard with ?? rather than a validator: a value that is present (even one of
  // the wrong type) is what they read. The setter always writes a well-typed value, so this only
  // happens in a hand-edited settings.json.
  it("keeps a saved keep-alive that isn't a number, since its getter only guards against absence", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ keepAliveMinutes: "5" }));
    expect((await load()).keepAliveMinutes()).toBe("5");
  });

  it("keeps a saved automations value that isn't a list, since its getter only guards against absence", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ automations: "weft:done" }));
    expect((await load()).automations()).toBe("weft:done");
  });

  it("keeps a saved push-on-done that isn't a boolean, since its getter only guards against absence", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ pushOnDone: "no" }));
    expect((await load()).pushOnDone()).toBe("no");
  });
});

describe("the folder lists' ?? [] fallbacks", () => {
  // The settings() initializer gives every list an empty array, so the ?? on the read and on the
  // write path is only reached when the in-memory state was set to null (a legacy settings.json
  // that was loaded into the singleton as null).
  const nulled = (fields: string[]) => {
    (g as { __weftSettings?: Record<string, unknown> }).__weftSettings = Object.fromEntries(fields.map((f) => [f, null]));
  };

  it("reads the issue folders as none when they were null", async () => {
    const s = await load();
    nulled(["issueFolders"]);
    expect(s.issueFolders()).toEqual([]);
  });

  it("turns issue sync on from a null list", async () => {
    const s = await load();
    nulled(["issueFolders"]);
    s.setIssueSync("/a", true);
    expect(s.issueFolders()).toEqual(["/a"]);
  });

  it("reads the allowed folders as none when they were null", async () => {
    const s = await load();
    nulled(["allowedFolders"]);
    expect(s.allowedFolders()).toEqual([]);
  });

  it("allows a folder from a null list", async () => {
    const s = await load();
    nulled(["allowedFolders"]);
    s.allowFolder("/a");
    expect(s.allowedFolders()).toEqual(["/a"]);
  });

  it("revokes a folder from a null list", async () => {
    const s = await load();
    nulled(["allowedFolders"]);
    s.unallowFolder("/a");
    expect(s.allowedFolders()).toEqual([]);
  });

  it("reads the sync folders as none when they were null", async () => {
    const s = await load();
    nulled(["syncFolders"]);
    expect(s.syncFolders()).toEqual([]);
  });

  it("turns cloud sync on from a null list", async () => {
    const s = await load();
    nulled(["syncFolders"]);
    s.setSyncFolder("/a", true);
    expect(s.syncFolders()).toEqual(["/a"]);
  });
});
