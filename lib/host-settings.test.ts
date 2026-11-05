import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { load, settingsDir, withSettingsDir } from "./settings.harness";

// A host's own settings (settings.get / settings.put) and the account's synced ones, on the settings file of whichever
// host runs them. Never a folder, a mode or a guard.
withSettingsDir();

async function loadHost() {
  const settings = await load();
  const host = await import("./host-settings");
  return { settings, host };
}

const onDisk = () => JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;

describe("host settings", () => {
  it("reads the four a worker carries", async () => {
    const { host } = await loadHost();
    expect(host.hostSettings()).toEqual({ maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude", gooseProviderId: "", gooseBaseUrl: "" });
  });

  it("saves a patch of them once every field checks out", async () => {
    const { host, settings } = await loadHost();
    expect(host.applyHostSettings({ maxThreads: 3, keepAliveMinutes: 60, worktreePool: 0, defaultBackend: "puku" })).toEqual({
      maxThreads: 3,
      keepAliveMinutes: 60,
      worktreePool: 0,
      defaultBackend: "puku",
      gooseProviderId: "",
      gooseBaseUrl: "",
    });
    expect(settings.maxThreads()).toBe(3);
    expect(host.applyHostSettings(undefined)).toMatchObject({ maxThreads: 3 });
  });

  it("saves nothing when one field is wrong", async () => {
    const { host, settings } = await loadHost();
    expect(() => host.applyHostSettings({ maxThreads: 2, worktreePool: 9 })).toThrow("worktreePool must be 0 to 3.");
    expect(() => host.applyHostSettings({ maxThreads: 2.5 })).toThrow(/maxThreads must be a whole number/);
    expect(() => host.applyHostSettings({ keepAliveMinutes: -1 })).toThrow(/keepAliveMinutes must be a number of minutes/);
    expect(() => host.applyHostSettings({ defaultBackend: "bash" })).toThrow(/defaultBackend must be one of/);
    expect(settings.maxThreads()).toBe(6);
  });

  it("refuses anything that isn't a host setting", async () => {
    const { host, settings } = await loadHost();
    expect(() => host.applyHostSettings({ allowedFolders: ["/"] })).toThrow("allowedFolders isn't a setting a worker takes from the network.");
    expect(() => host.applyHostSettings({ maxThreads: 2, defaultPermissionMode: "bypassPermissions" })).toThrow(/defaultPermissionMode/);
    expect(() => host.applyHostSettings("maxThreads")).toThrow("Those settings aren't a list of fields.");
    expect(() => host.applyHostSettings([9])).toThrow("Those settings aren't a list of fields.");
    expect(() => host.applyHostSettings(null)).toThrow("Those settings aren't a list of fields.");
    expect(settings.allowedFolders()).toEqual([]);
    expect(settings.defaultPermissionMode()).toBe("auto");
  });
});

describe("account settings", () => {
  it("sends every field explicitly, the default instructions as empty", async () => {
    const { host, settings } = await loadHost();
    expect(host.accountSettings()).toEqual({
      automations: [{ id: "default-done", on: "done", skill: "weft:done" }],
      pushOnDone: true,
      doneModel: "",
      doneEffort: "",
      subagentModel: "choose",
      threadPrompt: "",
      backupModel: "",
      agents: { saved: [], projects: {} },
    });
    settings.setThreadPrompt("be brief");
    expect(host.accountSettings().threadPrompt).toBe("be brief");
  });

  it("mirrors a snapshot: the account fields that check out, and only the ones that changed", async () => {
    const { host, settings } = await loadHost();
    const changed = host.applyAccountSettings({
      automations: [{ id: "r1", on: "done", skill: "/weft:commit" }],
      pushOnDone: false,
      doneModel: "claude-sonnet-5-5",
      doneEffort: "high",
      subagentModel: "inherit",
      threadPrompt: "be brief",
      backupModel: "",
      allowedFolders: ["/"],
      defaultPermissionMode: "bypassPermissions",
    });
    expect(changed).toEqual(["automations", "pushOnDone", "doneModel", "doneEffort", "subagentModel", "threadPrompt"]);
    expect(settings.automations()).toEqual([{ id: "r1", on: "done", skill: "weft:commit" }]);
    expect(settings.pushOnDone()).toBe(false);
    expect(settings.doneEffort()).toBe("high");
    expect(settings.threadPrompt()).toBe("be brief");
    expect(settings.allowedFolders()).toEqual([]);
    expect(settings.defaultPermissionMode()).toBe("auto");
    expect(onDisk().allowedFolders).toEqual([]);
    // The same snapshot again changes nothing and writes nothing.
    const write = vi.spyOn(fs, "writeFileSync");
    expect(host.applyAccountSettings({ pushOnDone: false, threadPrompt: "be brief" })).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("skips a field that doesn't check out and applies the rest; a reset goes back to the default", async () => {
    const { host, settings } = await loadHost();
    settings.setThreadPrompt("old");
    expect(
      host.applyAccountSettings({
        automations: [{ on: "nope", skill: "x" }],
        pushOnDone: "yes",
        doneModel: "gpt-nothing",
        doneEffort: "max-ish",
        subagentModel: 3,
        threadPrompt: "",
        backupModel: "claude-haiku-4-5",
      }),
    ).toEqual(["threadPrompt", "backupModel"]);
    expect(settings.threadPrompt()).toBe(settings.DEFAULT_THREAD_PROMPT);
    expect(settings.automations()).toEqual([{ id: "default-done", on: "done", skill: "weft:done" }]);
    expect(host.applyAccountSettings({ threadPrompt: "x".repeat(32_001) })).toEqual([]);
    expect(host.applyAccountSettings(null)).toEqual([]);
  });
});

describe("your agents on a worker", () => {
  const soul = { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review." };

  it("mirrors your Mac's agents and worker-project defaults, and the same again changes nothing", async () => {
    const { host } = await loadHost();
    const agents = await import("./agent-store");
    const snapshot = { saved: [soul], projects: { "worker://w-1/weft": "a-1" } };
    expect(host.applyAccountSettings({ agents: snapshot })).toEqual(["agents"]);
    expect(agents.listAgents().find((a) => a.id === "a-1")?.soul).toBe("You review.");
    expect(agents.projectAgent("worker://w-1/weft")).toBe("a-1");
    expect(host.accountSettings().agents).toEqual(snapshot);
    expect(host.applyAccountSettings({ agents: snapshot })).toEqual([]);
    expect(host.applyAccountSettings({ agents: "all of them" })).toEqual([]);
  });
});
