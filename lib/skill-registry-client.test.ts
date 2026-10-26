// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSkill } from "./types";

const clientApi = vi.hoisted(() => ({
  call: vi.fn<(method: string, url: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>>(),
  create: vi.fn<(input: unknown) => Promise<{ card: { id: string } }>>(),
}));
vi.mock("./client-api", () => ({ call: clientApi.call, api: { create: clientApi.create } }));

import { skillRegistry, startSkillThread } from "./skill-registry-client";
import { LAST_BACKEND, MODELS } from "./new-thread";
import { skillThreadPrompt, skillThreadTitle } from "./skill-thread";

const hit: RemoteSkill = {
  id: "owner/repo/skill",
  source: "owner/repo",
  name: "skill",
  installs: 12,
  installed: false,
};

beforeEach(() => {
  localStorage.clear();
  clientApi.call.mockReset().mockResolvedValue({});
  clientApi.create.mockReset().mockResolvedValue({ card: { id: "card-1" } });
});

describe("skillRegistry", () => {
  it("searches with the query and cwd, encoding both", () => {
    void skillRegistry.search("a b", "/my folder");
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/search?q=a%20b&cwd=%2Fmy%20folder", undefined, undefined);
  });

  it("searches without a cwd, dropping the empty value", () => {
    void skillRegistry.search("deck");
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/search?q=deck", undefined, undefined);
  });

  it("passes the abort signal through on a search", () => {
    const signal = new AbortController().signal;
    void skillRegistry.search("deck", "/proj", signal);
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/search?q=deck&cwd=%2Fproj", undefined, signal);
  });

  it("previews a remote skill by id and cwd", () => {
    void skillRegistry.preview("owner/repo/skill", "/my folder");
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/remote?id=owner%2Frepo%2Fskill&cwd=%2Fmy%20folder");
  });

  it("previews without a cwd", () => {
    void skillRegistry.preview("owner/repo/skill");
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/remote?id=owner%2Frepo%2Fskill");
  });

  it("installs a skill, without force by default", () => {
    void skillRegistry.install("owner/repo/skill");
    expect(clientApi.call).toHaveBeenCalledWith("POST", "/api/skills/remote", { id: "owner/repo/skill", force: false });
  });

  it("installs a skill with force", () => {
    void skillRegistry.install("owner/repo/skill", true);
    expect(clientApi.call).toHaveBeenCalledWith("POST", "/api/skills/remote", { id: "owner/repo/skill", force: true });
  });

  it("starts a review for a card target", () => {
    void skillRegistry.review({ id: "c1" });
    expect(clientApi.call).toHaveBeenCalledWith("POST", "/api/skills/review", { id: "c1" });
  });

  it("reads the review state of a card target", () => {
    void skillRegistry.reviewState({ id: "c1", hash: "abc" });
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/review?id=c1&hash=abc");
  });

  it("reads the review state of a local target", () => {
    void skillRegistry.reviewState({ cwd: "/my folder", name: "deck" });
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/review?cwd=%2Fmy%20folder&name=deck");
  });

  it("scans the library for a cwd", () => {
    void skillRegistry.scans("/my folder");
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/scan?cwd=%2Fmy%20folder");
  });

  it("scans the library without a cwd", () => {
    void skillRegistry.scans();
    expect(clientApi.call).toHaveBeenCalledWith("GET", "/api/skills/scan?");
  });
});

describe("startSkillThread", () => {
  it("starts on Claude when no backend was remembered", async () => {
    const id = await startSkillThread(hit, "/proj");
    expect(id).toBe("card-1");
    expect(clientApi.create).toHaveBeenCalledWith({
      title: "✦ Skill: /skill",
      prompt: skillThreadPrompt(hit),
      cwd: "/proj",
      backend: "claude",
      model: undefined,
      start: true,
    });
  });

  it("starts on the remembered backend when it is a known one", async () => {
    localStorage.setItem(LAST_BACKEND, "puku");
    await startSkillThread(hit, "/proj");
    expect(clientApi.create).toHaveBeenCalledWith(expect.objectContaining({ backend: "puku" }));
  });

  it("falls back to Claude when the remembered backend is not a known one", async () => {
    localStorage.setItem(LAST_BACKEND, "not-a-backend");
    await startSkillThread(hit, "/proj");
    expect(clientApi.create).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude" }));
  });

  it("passes the remembered model when that backend serves it", async () => {
    const model = MODELS.puku[0]!.id;
    localStorage.setItem(LAST_BACKEND, "puku");
    localStorage.setItem("weft.model.puku", model);
    await startSkillThread(hit, "/proj");
    expect(clientApi.create).toHaveBeenCalledWith(expect.objectContaining({ backend: "puku", model }));
  });

  it("drops a remembered model the backend does not serve", async () => {
    localStorage.setItem(LAST_BACKEND, "puku");
    localStorage.setItem("weft.model.puku", "claude-haiku-5-5");
    await startSkillThread(hit, "/proj");
    expect(clientApi.create).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
  });

  it("sends no model when the remembered model is empty", async () => {
    localStorage.setItem(LAST_BACKEND, "puku");
    localStorage.setItem("weft.model.puku", "");
    await startSkillThread(hit, "/proj");
    expect(clientApi.create).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
  });

  it("titles and prompts the thread after the hit", async () => {
    await startSkillThread(hit, "/proj");
    const input = clientApi.create.mock.calls[0]![0] as { title: string; prompt: string };
    expect(input.title).toBe(skillThreadTitle(hit));
    expect(input.prompt).toBe(skillThreadPrompt(hit));
  });
});
