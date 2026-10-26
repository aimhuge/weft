import { describe, expect, it } from "vitest";
import { api } from "./client-api";
import { bodyOf, callOf } from "./client-api.harness";

// The fetch client's other half: the copilot, the services, the projects, the account and the
// connectors. The card-side methods live in lib/client-api.test.ts; the fake fetch and the helpers
// that read it live in lib/client-api.harness.ts.

describe("the api methods", () => {
  it("reads the services drawer and drives a process", async () => {
    await api.services();
    expect(callOf().url).toBe("/api/services");
    await api.launchDev("/x", "pnpm dev");
    expect(bodyOf()).toEqual({ action: "launch", cwd: "/x", command: "pnpm dev" });
    await api.serviceAction({ action: "kill", id: "s1" });
    expect(bodyOf()).toEqual({ action: "kill", id: "s1" });
    await api.serviceAction({ action: "restart", id: "s1" });
    expect(bodyOf()).toEqual({ action: "restart", id: "s1" });
  });

  it("reads the copilot, resets it, and picks a persona", async () => {
    await api.copilot();
    expect(callOf().url).toBe("/api/copilot");
    await api.resetCopilot();
    expect(callOf().init?.method).toBe("POST");
    await api.copilotPersona("captain");
    expect(callOf().url).toBe("/api/copilot/persona");
    await api.copilotSuggestions();
    expect(callOf().url).toBe("/api/copilot/suggestions");
    await api.copilotChipClicked("ship it");
    expect(bodyOf()).toEqual({ text: "ship it" });
  });

  it("reads and drives the restart", async () => {
    await api.restartStatus();
    expect(callOf().url).toBe("/api/restart");
    await api.restartWhenIdle();
    expect(bodyOf()).toEqual({});
    await api.cancelRestart();
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("reads the settings and saves a patch", async () => {
    await api.settings();
    expect(callOf().url).toBe("/api/settings");
    await api.saveSettings({ keepAliveMinutes: 10 });
    expect(callOf().init?.method).toBe("PATCH");
    expect(bodyOf()).toEqual({ keepAliveMinutes: 10 });
  });

  it("lists and starts a theme", async () => {
    await api.themes();
    expect(callOf().url).toBe("/api/themes");
    await api.createTheme("neon");
    expect(bodyOf()).toEqual({ prompt: "neon" });
  });

  it("adds, creates and removes a project", async () => {
    await api.addProject("/x");
    expect(callOf().url).toBe("/api/projects");
    await api.newProject("/x", "app");
    expect(callOf().url).toBe("/api/projects/new");
    expect(bodyOf()).toEqual({ parent: "/x", name: "app" });
    await api.removeProject("/x");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("re-seeds a project's backlog", async () => {
    await api.seedProject("/x");
    expect(callOf().url).toBe("/api/projects/seed");
  });

  it("reads the login status and drives a login", async () => {
    await api.loginStatus();
    expect(callOf().url).toBe("/api/login");
    await api.login("claude", "start");
    expect(bodyOf()).toEqual({ backend: "claude", action: "start", text: undefined });
    await api.login("claude", "input", "yes");
    expect(bodyOf()).toEqual({ backend: "claude", action: "input", text: "yes" });
  });

  it("reads the Google Workspace connector and drives it", async () => {
    await api.gogStatus();
    expect(callOf().url).toBe("/api/connectors/gog");
    await api.gog({ action: "credentials", json: "{}" });
    expect(bodyOf()).toEqual({ action: "credentials", json: "{}" });
    await api.gog({ action: "add", email: "a@b.com", readonly: true });
    expect(bodyOf()).toEqual({ action: "add", email: "a@b.com", readonly: true });
    await api.gog({ action: "cancel" });
    expect(bodyOf()).toEqual({ action: "cancel" });
    await api.gog({ action: "remove", email: "a@b.com", client: "weft" });
    expect(bodyOf()).toEqual({ action: "remove", email: "a@b.com", client: "weft" });
  });

  it("warms a CLI ahead of time", async () => {
    await api.warm({ cardId: "c1", cwd: "/x", backend: "claude" });
    expect(callOf().url).toBe("/api/warm");
    expect(bodyOf()).toEqual({ cardId: "c1", cwd: "/x", backend: "claude" });
  });

  it("runs a project's intake", async () => {
    await api.intake("/x");
    expect(callOf().url).toBe("/api/projects/intake");
    expect(bodyOf()).toEqual({ folder: "/x" });
  });

  it("asks for the new-thread page", async () => {
    await api.newThreadPage();
    expect(callOf().url).toBe("/api/new-thread-page");
  });

  it("searches the prompts", async () => {
    await api.searchPrompts("dark mode");
    expect(callOf().url).toBe("/api/search?q=dark%20mode");
  });

  it("reads a card's thread", async () => {
    await api.thread("c1");
    expect(callOf().url).toBe("/api/cards/c1/thread");
  });

  it("lists the skills, with and without a folder", async () => {
    await api.skills();
    expect(callOf().url).toBe("/api/skills");
    await api.skills("/my folder");
    expect(callOf().url).toBe("/api/skills?cwd=%2Fmy%20folder");
  });

  it("reads a skill set by folder or card, and turns one on or off", async () => {
    await api.skillSet({ cwd: "/x" });
    expect(callOf().url).toBe("/api/skills/set?cwd=%2Fx");
    await api.skillSet({ card: "c1" });
    expect(callOf().url).toBe("/api/skills/set?card=c1");
    await api.setSkill({ cwd: "/x" }, "lint", true);
    expect(callOf().init?.method).toBe("PUT");
    expect(bodyOf()).toEqual({ cwd: "/x", name: "lint", on: true });
  });

  it("reads the dictation status", async () => {
    await api.dictation();
    expect(callOf().url).toBe("/api/transcribe");
  });

  it("lists the local and GitHub repos, fresh or not", async () => {
    await api.repos();
    expect(callOf().url).toBe("/api/repos");
    await api.repos(true);
    expect(callOf().url).toBe("/api/repos?fresh=1");
    await api.githubRepos();
    expect(callOf().url).toBe("/api/repos/github");
    await api.githubRepos(true);
    expect(callOf().url).toBe("/api/repos/github?fresh=1");
  });

  it("reads the account, signs in, and signs out", async () => {
    await api.account();
    expect(callOf().url).toBe("/api/account");
    await api.signIn("github");
    expect(bodyOf()).toEqual({ action: "oauth", provider: "github" });
    await api.signIn("github", "/next");
    expect(bodyOf()).toEqual({ action: "oauth", provider: "github", next: "/next" });
    await api.magicLink("a@b.com");
    expect(bodyOf()).toEqual({ action: "email", email: "a@b.com" });
    await api.signOut();
    expect(bodyOf()).toEqual({ action: "signout" });
  });

  it("reads the billing status and starts a checkout", async () => {
    await api.billingStatus();
    expect(callOf().url).toBe("/api/account/billing");
    await api.billingCheckout("pro", "monthly");
    expect(callOf().url).toBe("/api/account/billing/checkout");
    expect(bodyOf()).toEqual({ plan: "pro", interval: "monthly" });
  });

  it("clones a repo", async () => {
    await api.cloneRepo("me/app");
    expect(callOf().url).toBe("/api/repos/clone");
    expect(bodyOf()).toEqual({ fullName: "me/app" });
  });

  it("imports and stops the GitHub issue sync", async () => {
    await api.importIssues("/x");
    expect(callOf().url).toBe("/api/github/issues");
    expect(bodyOf()).toEqual({ folder: "/x" });
    await api.stopIssues("/x");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("adds and removes a GitHub webhook", async () => {
    await api.addHook("/x");
    expect(callOf().url).toBe("/api/github/hooks");
    await api.removeHook("/x");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("connects BlastCP and drives the Vercel hooks", async () => {
    await api.connectBlastcpWithWeft();
    expect(callOf().url).toBe("/api/blastcp");
    await api.vercelHooks();
    expect(callOf().url).toBe("/api/vercel/hooks");
    await api.addVercelHook("/x");
    expect(bodyOf()).toEqual({ folder: "/x" });
    await api.removeVercelHook("/x");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("reads the GitHub drawer for a set of folders", async () => {
    await api.github(["/a", "/b"]);
    expect(callOf().url).toBe("/api/github?folder=%2Fa&folder=%2Fb");
  });

  it("reads and drives the cloud sync", async () => {
    await api.cloudSync();
    expect(callOf().url).toBe("/api/cloud-sync");
    await api.cloudSyncSetFolder("/x", true);
    expect(bodyOf()).toEqual({ folder: "/x", on: true });
    await api.cloudSyncNow();
    expect(bodyOf()).toEqual({ sync: true });
  });

  it("reads and drives the webhooks", async () => {
    await api.webhooks(["/a"]);
    expect(callOf().url).toBe("/api/webhooks?folder=%2Fa");
    await api.addWebhook({ folder: "/a", event: "push" } as never);
    expect(callOf().url).toBe("/api/webhooks");
    await api.updateWebhook("w1", { event: "issues" } as never);
    expect(callOf().url).toBe("/api/webhooks/w1");
    expect(callOf().init?.method).toBe("PATCH");
    await api.removeWebhook("w1");
    expect(callOf().init?.method).toBe("DELETE");
    await api.relayWebhook("w1");
    expect(callOf().url).toBe("/api/webhooks/w1/relay");
    await api.unrelayWebhook("w1");
    expect(callOf().init?.method).toBe("DELETE");
  });
});
