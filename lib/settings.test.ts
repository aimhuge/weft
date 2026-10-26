import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { g, load, settingsDir, withSettingsDir } from "./settings.harness";

withSettingsDir();

describe("settings", () => {
  it("starts with the default prompt, no keep-alive and the done automation", async () => {
    const s = await load();
    expect(s.threadPrompt()).toBe(s.DEFAULT_THREAD_PROMPT);
    expect(s.keepAliveMinutes()).toBe(0);
    expect(s.automations()).toEqual([{ id: "default-done", on: "done", skill: "weft:done" }]);
    expect(s.listProjects()).toEqual([]);
  });

  it("caps running threads at 6 unless set, clamps what's set, and keeps only a non-default on disk", async () => {
    const s = await load();
    expect(s.maxThreads()).toBe(6);
    s.setMaxThreads(3.4);
    expect(s.maxThreads()).toBe(3);
    s.setMaxThreads(0);
    expect(s.maxThreads()).toBe(0);
    s.setMaxThreads(500);
    expect(s.maxThreads()).toBe(50);
    s.setMaxThreads(-2);
    expect(s.maxThreads()).toBe(0);
    s.setMaxThreads(6);
    expect((JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as { maxThreads?: number }).maxThreads).toBeUndefined();
    expect(s.settingsView().maxThreads).toBe(6);
  });

  it("the default prompt still asks for the BOARD STATUS line", async () => {
    const s = await load();
    expect(s.DEFAULT_THREAD_PROMPT).toContain("BOARD STATUS: column=");
  });

  it("an empty prompt goes back to the default; a custom one is trimmed and persisted", async () => {
    let s = await load();
    s.setThreadPrompt("  be terse  ");
    expect(s.threadPrompt()).toBe("be terse");
    s = await load();
    expect(s.threadPrompt()).toBe("be terse");
    s.setThreadPrompt("   ");
    expect(s.threadPrompt()).toBe(s.DEFAULT_THREAD_PROMPT);
  });

  it("clamps keep-alive to 0..one week and rounds", async () => {
    const s = await load();
    s.setKeepAliveMinutes(-5);
    expect(s.keepAliveMinutes()).toBe(0);
    s.setKeepAliveMinutes(12.6);
    expect(s.keepAliveMinutes()).toBe(13);
    s.setKeepAliveMinutes(10 ** 9);
    expect(s.keepAliveMinutes()).toBe(7 * 24 * 60);
  });

  it("new threads start in Auto until another default mode is saved", async () => {
    let s = await load();
    expect(s.defaultPermissionMode()).toBe("auto");
    s.setDefaultPermissionMode("acceptEdits");
    s = await load();
    expect(s.defaultPermissionMode()).toBe("acceptEdits");
    expect(s.settingsView().defaultPermissionMode).toBe("acceptEdits");
  });

  it("new threads start on the claude backend until another default is saved", async () => {
    let s = await load();
    expect(s.defaultBackend()).toBe("claude");
    s.setDefaultBackend("puku");
    s = await load();
    expect(s.defaultBackend()).toBe("puku");
    expect(s.settingsView().defaultBackend).toBe("puku");
  });

  it("push on Done is on until it's turned off, and the off is written for push.sh to read", async () => {
    let s = await load();
    expect(s.pushOnDone()).toBe(true);
    expect(s.settingsView().pushOnDone).toBe(true);
    s.setPushOnDone(false);
    s = await load();
    expect(s.pushOnDone()).toBe(false);
    expect(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")).toContain('"pushOnDone": false');
  });

  it("subagents default to letting the model choose, which is stored as unset", async () => {
    let s = await load();
    expect(s.subagentModel()).toBe("choose");
    expect(s.settingsView().subagentModel).toBe("choose");
    s.setSubagentModel("opus-4.8");
    s = await load();
    expect(s.subagentModel()).toBe("opus-4.8");
    s.setSubagentModel("choose");
    expect(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")).not.toContain("subagentModel");
  });

  it("an unknown saved subagent model reads as choose", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ subagentModel: "gpt" }));
    expect((await load()).subagentModel()).toBe("choose");
  });

  it("/weft:done model and effort default to empty (use the card's own), and are stored as unset", async () => {
    let s = await load();
    expect(s.doneModel()).toBe("");
    expect(s.doneEffort()).toBe("");
    expect(s.settingsView().doneModel).toBe("");
    expect(s.settingsView().doneEffort).toBe("");
    s.setDoneModel("claude-opus-5-5");
    s.setDoneEffort("xhigh");
    s = await load();
    expect(s.doneModel()).toBe("claude-opus-5-5");
    expect(s.doneEffort()).toBe("xhigh");
    s.setDoneModel("");
    s.setDoneEffort("");
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("doneModel" in saved).toBe(false);
    expect("doneEffort" in saved).toBe(false);
  });

  it("an unknown saved done model or effort reads as empty", async () => {
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ doneModel: "gpt-7", doneEffort: "extreme" }),
    );
    const s = await load();
    expect(s.doneModel()).toBe("");
    expect(s.doneEffort()).toBe("");
  });

  it("the copilot model defaults to empty and takes any model a CLI serves", async () => {
    let s = await load();
    expect(s.copilotModel()).toBe("");
    expect(s.settingsView().copilotModel).toBe("");
    s.setCopilotModel("claude-haiku-5-5");
    s = await load();
    expect(s.copilotModel()).toBe("claude-haiku-5-5");
    s.setCopilotModel("puku-ai-2.8");
    s = await load();
    expect(s.copilotModel()).toBe("puku-ai-2.8");
    s.setCopilotModel("");
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("copilotModel" in saved).toBe(false);
  });

  it("a saved copilot model no CLI serves reads as empty", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ copilotModel: "gone-1" }));
    expect((await load()).copilotModel()).toBe("");
  });

  it("the Review all model defaults to empty, takes any model, and clears on empty", async () => {
    let s = await load();
    expect(s.reviewAllModel()).toBe("");
    expect(s.settingsView().reviewAllModel).toBe("");
    s.setReviewAllModel("claude-sonnet-5-5");
    s = await load();
    expect(s.reviewAllModel()).toBe("claude-sonnet-5-5");
    s.setReviewAllModel("puku-ai-2.8");
    s = await load();
    expect(s.reviewAllModel()).toBe("puku-ai-2.8");
    s.setReviewAllModel("");
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("reviewAllModel" in saved).toBe(false);
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ reviewAllModel: "gone-1" }));
    expect((await load()).reviewAllModel()).toBe("");
  });

  it("the Goose provider defaults to none, takes a provider from the catalog, and refuses one it doesn't know", async () => {
    let s = await load();
    expect(s.gooseProviderId()).toBe("");
    expect(s.settingsView().gooseProviderId).toBe("");
    s.setGooseProviderId("openrouter");
    s = await load();
    expect(s.gooseProviderId()).toBe("openrouter");
    expect(s.settingsView().gooseProviderId).toBe("openrouter");
    expect(() => s.setGooseProviderId("nope")).toThrow(/doesn't know a provider called "nope"/);
  });

  it("an unknown saved Goose provider reads as none", async () => {
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ gooseProviderId: "gone" }));
    expect((await load()).gooseProviderId()).toBe("");
  });

  it("the Goose model and endpoint default to empty, and are stored as unset", async () => {
    let s = await load();
    expect(s.gooseModelId()).toBe("");
    expect(s.gooseBaseUrl()).toBe("");
    expect(s.settingsView().gooseModelId).toBe("");
    expect(s.settingsView().gooseBaseUrl).toBe("");
    s.setGooseModelId("anthropic/claude-sonnet-4.5");
    s.setGooseBaseUrl("https://api.example.com/v1");
    s = await load();
    expect(s.gooseModelId()).toBe("anthropic/claude-sonnet-4.5");
    expect(s.gooseBaseUrl()).toBe("https://api.example.com/v1");
    s.setGooseModelId("");
    s.setGooseBaseUrl("");
    const saved = JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;
    expect("gooseModelId" in saved).toBe(false);
    expect("gooseBaseUrl" in saved).toBe(false);
  });

  it("the named models read as none until one is saved, and a malformed list reads as none", async () => {
    let s = await load();
    expect(s.gooseNamedModels()).toEqual([]);
    expect(s.settingsView().gooseNamedModels).toEqual([]);
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ gooseNamedModels: [{ id: "gpt-5", name: "The one I like" }] }),
    );
    s = await load();
    expect(s.gooseNamedModels()).toEqual([{ id: "gpt-5", name: "The one I like" }]);
    expect(s.settingsView().gooseNamedModels).toEqual([{ id: "gpt-5", name: "The one I like" }]);

    // A list that isn't pairs of strings is not a list of named models: it reads as none.
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ gooseNamedModels: [{ id: "gpt-5" }] }),
    );
    s = await load();
    expect(s.gooseNamedModels()).toEqual([]);
  });

  it("an empty automations list is kept, not replaced by the defaults", async () => {
    const s = await load();
    s.setAutomations([]);
    expect(s.automations()).toEqual([]);
  });

  it("dismissSession dedupes", async () => {
    const s = await load();
    s.dismissSession("a");
    s.dismissSession("a");
    s.dismissSession("b");
    expect(s.dismissedSessions()).toEqual(["a", "b"]);
  });

  it("dismissedSessions is empty on a fresh state, before any dismiss", async () => {
    const s = await load();
    expect(s.dismissedSessions()).toEqual([]);
  });

  it("dismissSession works when dismissedSessions is not yet set, and the read recovers from a deleted entry", async () => {
    // First dismiss: settings().dismissedSessions is undefined, so the ?? [] inside takes the right.
    let s = await load();
    s.dismissSession("a");
    expect(s.dismissedSessions()).toEqual(["a"]);
    // Reload from disk: the saved array is loaded as defined; the next dismiss takes the left of ??.
    s = await load();
    s.dismissSession("b");
    expect(s.dismissedSessions()).toEqual(["a", "b"]);
  });

  it("the ?? [] fallbacks on the read and the dismiss path run when dismissedSessions was set to null", async () => {
    // The ?? [] on lines 90 and 95 is otherwise dead: settings() initializes the field to []. A legacy
    // settings.json (or a test that resets it) can leave it as null, and the fallbacks should still
    // produce a usable array.
    const s = await load();
    (g as { __weftSettings?: { dismissedSessions?: string[] | null } }).__weftSettings = {
      dismissedSessions: null,
    };
    expect(s.dismissedSessions()).toEqual([]);
    s.dismissSession("a");
    expect(s.dismissedSessions()).toEqual(["a"]);
  });

  it("pins and hides projects; using one again unhides it and keeps its pin", async () => {
    const s = await load();
    s.touchProject("/a");
    s.markProject("/a", { pinned: true, hidden: true });
    expect(s.listProjects().find((p) => p.path === "/a")).toMatchObject({ pinned: true, hidden: true });
    s.touchProject("/a");
    const used = s.listProjects().find((p) => p.path === "/a");
    expect(used).toMatchObject({ pinned: true });
    expect(used?.hidden).toBeUndefined();
    s.markProject("/a", { pinned: false });
    expect(Object.keys(s.listProjects().find((p) => p.path === "/a") ?? {})).toEqual(["path", "lastUsedAt"]);
  });

  it("marking a folder only cards use saves it with no use of its own", async () => {
    const s = await load();
    s.markProject("/cards-only", { hidden: true });
    expect(s.listProjects().find((p) => p.path === "/cards-only")).toEqual({ path: "/cards-only", lastUsedAt: 0, hidden: true });
  });

  it("a full list drops the oldest unpinned project, never a pinned one", async () => {
    const s = await load();
    s.touchProject("/old");
    s.markProject("/old", { pinned: true });
    for (let i = 0; i < 45; i++) s.touchProject(`/p${i}`);
    const paths = s.listProjects().map((p) => p.path);
    expect(paths).toContain("/old");
    expect(paths).not.toContain("/p0");
    expect(paths).toHaveLength(41);
  });

  it("settings survive a reload and settingsView bundles them", async () => {
    let s = await load();
    s.setKeepAliveMinutes(30);
    s.touchProject("/x");
    s = await load();
    const view = s.settingsView();
    expect(view.keepAliveMinutes).toBe(30);
    expect(view.projects[0]!.path).toBe("/x");
    expect(view.defaultThreadPrompt).toBe(s.DEFAULT_THREAD_PROMPT);
    expect(fs.existsSync(path.join(settingsDir.path, "settings.json"))).toBe(true);
  });
});
