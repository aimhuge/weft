import { describe, expect, it } from "vitest";
import { cloneBody, cloneCommand, githubLoginCommand, inputBody, inputCommand, isWorkerDevice, loginCommand, modeBody, modeCommand, runBody, runCommand, RUN_MODES, workerDevice } from "./worker-commands";
import { GITHUB_PURPOSE, LOGIN_PURPOSE, newSealKeys, open, sealedOf } from "./worker-seal";

// A payload as it comes off the wire: the shape the row claims, not the shape it must be.
const wire = (payload: unknown) => ({ payload }) as { payload: never };

describe("workerDevice / isWorkerDevice", () => {
  it("names a worker with the worker: prefix", () => {
    expect(workerDevice("w-1")).toBe("worker:w-1");
  });

  it("recognises only worker: devices", () => {
    expect(isWorkerDevice("worker:w-1")).toBe(true);
    expect(isWorkerDevice("worker:")).toBe(true);
    expect(isWorkerDevice("mac-1")).toBe(false);
    expect(isWorkerDevice("")).toBe(false);
  });
});

describe("runCommand", () => {
  const target = { orgId: "org-1", workerId: "w-1", folder: "weft" };

  it("builds a run row addressed to the worker", () => {
    expect(runCommand(target, { prompt: "Add dark mode" })).toEqual({
      org_id: "org-1",
      kind: "run",
      target_device: "worker:w-1",
      folder: "weft",
      payload: { prompt: "Add dark mode" },
    });
  });

  it("trims the prompt and the folder", () => {
    const row = runCommand({ ...target, folder: "  weft  " }, { prompt: "  do it  " });
    expect(row?.folder).toBe("weft");
    expect(row?.payload).toEqual({ prompt: "do it" });
  });

  it("is null with an empty prompt or an empty folder", () => {
    expect(runCommand(target, { prompt: "   " })).toBeNull();
    expect(runCommand({ ...target, folder: "  " }, { prompt: "do it" })).toBeNull();
  });

  it("carries a repo and a model when they're there", () => {
    const row = runCommand(target, { prompt: "do it", repo: " https://github.com/a/b.git ", model: " sonnet " });
    expect(row?.payload).toEqual({ prompt: "do it", repo: "https://github.com/a/b.git", model: "sonnet" });
  });

  it("leaves a blank repo and model out", () => {
    const row = runCommand(target, { prompt: "do it", repo: "   ", model: "" });
    expect(row?.payload).toEqual({ prompt: "do it" });
    expect(row?.payload).not.toHaveProperty("repo");
    expect(row?.payload).not.toHaveProperty("model");
  });

  it("keeps a known permission mode and drops an unknown one", () => {
    expect(runCommand(target, { prompt: "do it", permissionMode: "plan" })?.payload).toEqual({ prompt: "do it", permissionMode: "plan" });
    expect(runCommand(target, { prompt: "do it", permissionMode: "default" })?.payload).toEqual({ prompt: "do it", permissionMode: "default" });
    expect(runCommand(target, { prompt: "do it", permissionMode: "acceptEdits" })?.payload).toEqual({
      prompt: "do it",
      permissionMode: "acceptEdits",
    });
  });

  it("refuses bypassPermissions and anything else it doesn't know", () => {
    const row = runCommand(target, { prompt: "do it", permissionMode: "bypassPermissions" });
    expect(row?.payload).toEqual({ prompt: "do it" });
    expect(row?.payload).not.toHaveProperty("permissionMode");
    expect(runCommand(target, { prompt: "do it", permissionMode: "yolo" })?.payload).not.toHaveProperty("permissionMode");
  });

  it("knows exactly three modes", () => {
    expect([...RUN_MODES]).toEqual(["default", "acceptEdits", "auto", "plan"]);
  });
});

describe("runBody", () => {
  it("reads the card fields off the wire", () => {
    expect(runBody(wire({ prompt: "Add dark mode", title: "Dark mode", model: "sonnet", repo: "https://x/y.git" }))).toEqual({
      prompt: "Add dark mode",
      title: "Dark mode",
      model: "sonnet",
      repo: "https://x/y.git",
    });
  });

  it("is null without a prompt", () => {
    expect(runBody(wire({ prompt: "   " }))).toBeNull();
    expect(runBody(wire({ prompt: 42 }))).toBeNull();
    expect(runBody(wire({}))).toBeNull();
  });

  it("is null when the payload isn't an object", () => {
    expect(runBody(wire(null))).toBeNull();
    expect(runBody(wire("nope"))).toBeNull();
    expect(runBody(wire(undefined))).toBeNull();
  });

  it("keeps only a known backend", () => {
    expect(runBody(wire({ prompt: "x", backend: "claude" }))?.backend).toBe("claude");
    expect(runBody(wire({ prompt: "x", backend: "codex" }))?.backend).toBe("codex");
    expect(runBody(wire({ prompt: "x", backend: "puku" }))?.backend).toBe("puku");
    expect(runBody(wire({ prompt: "x", backend: "goose" }))?.backend).toBe("goose");
    expect(runBody(wire({ prompt: "x", backend: "gpt" }))?.backend).toBeUndefined();
    expect(runBody(wire({ prompt: "x", backend: 7 }))?.backend).toBeUndefined();
  });

  it("carries an effort as it came", () => {
    expect(runBody(wire({ prompt: "x", effort: "high" }))?.effort).toBe("high");
    expect(runBody(wire({ prompt: "x", effort: "" }))?.effort).toBeUndefined();
  });

  it("keeps only a known permission mode", () => {
    expect(runBody(wire({ prompt: "x", permissionMode: "plan" }))?.permissionMode).toBe("plan");
    expect(runBody(wire({ prompt: "x", permissionMode: "bypassPermissions" }))?.permissionMode).toBeUndefined();
    expect(runBody(wire({ prompt: "x", permissionMode: "nope" }))?.permissionMode).toBeUndefined();
  });

  it("keeps only string tags", () => {
    expect(runBody(wire({ prompt: "x", tags: ["a", 1, "b"] }))?.tags).toEqual(["a", "b"]);
    expect(runBody(wire({ prompt: "x", tags: "nope" }))?.tags).toBeUndefined();
    expect(runBody(wire({ prompt: "x", tags: [] }))?.tags).toEqual([]);
  });

  it("leaves out fields that aren't there", () => {
    const body = runBody(wire({ prompt: "x" }));
    expect(body).toEqual({ prompt: "x" });
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("repo");
    expect(body).not.toHaveProperty("tags");
  });

  it("trims the text it keeps", () => {
    expect(runBody(wire({ prompt: "  do it  ", title: "  Dark  " }))).toEqual({ prompt: "do it", title: "Dark" });
  });
});

describe("loginCommand", () => {
  const TOKEN = ["sk-ant", "oat01", "abcdefghijklmnopqrstuvwxyz0123"].join("-");

  it("seals the token to the worker's key, so the row never holds it", () => {
    const keys = newSealKeys();
    const row = loginCommand({ orgId: "org-1", workerId: "w-1", publicKey: keys.publicKey }, `  ${TOKEN}\n`);
    expect(row).toMatchObject({ org_id: "org-1", kind: "login", target_device: "worker:w-1", folder: "-" });
    expect(JSON.stringify(row)).not.toContain("sk-ant");
    const sealed = sealedOf((row?.payload as { token: unknown }).token);
    expect(sealed && open(keys, sealed, LOGIN_PURPOSE)).toBe(TOKEN);
  });

  it("refuses what isn't a Claude Code token", () => {
    expect(loginCommand({ orgId: "o", workerId: "w", publicKey: newSealKeys().publicKey }, "hello")).toBeNull();
  });
});

describe("githubLoginCommand", () => {
  const token = `github_pat_${"a".repeat(30)}`;

  it("seals a token only that worker can open, for GitHub and nothing else", () => {
    const keys = newSealKeys();
    const row = githubLoginCommand({ orgId: "o", workerId: "w", publicKey: keys.publicKey }, ` ${token} `);
    expect(row).toMatchObject({ kind: "github_login", target_device: "worker:w", folder: "-" });
    const sealed = sealedOf((row?.payload as { token: unknown }).token);
    expect(sealed && open(keys, sealed, GITHUB_PURPOSE)).toBe(token);
    expect(() => sealed && open(keys, sealed, LOGIN_PURPOSE)).toThrow();
  });

  it("is null for what is not a GitHub token", () => {
    expect(githubLoginCommand({ orgId: "o", workerId: "w", publicKey: newSealKeys().publicKey }, "sk-ant-nope")).toBeNull();
  });
});

describe("cloneCommand / cloneBody", () => {
  const target = { orgId: "o", workerId: "w" };

  it("builds the https URL and names the folder for the repo", () => {
    const row = cloneCommand(target, " aimhuge/weft ");
    expect(row).toEqual({ org_id: "o", kind: "clone", target_device: "worker:w", folder: "weft", payload: { repo: "https://github.com/aimhuge/weft.git" } });
    expect(row && cloneBody(row)).toBe("https://github.com/aimhuge/weft.git");
  });

  it("refuses anything but owner/name, and a hidden folder", () => {
    for (const slug of ["weft", "a/b/c", "a b/c", "a/..", "a/.github", ""]) expect(cloneCommand(target, slug)).toBeNull();
  });

  it("reads no repo from a payload without one", () => {
    expect(cloneBody({ payload: {} as never })).toBeNull();
    expect(cloneBody({ payload: null as never })).toBeNull();
    expect(cloneBody({ payload: { repo: 7 } as never })).toBeNull();
  });
});

describe("a worker card's mode and screen commands", () => {
  const target = { orgId: "o", device: "worker:w", folder: "f", cardId: "c" };

  it("never sends or obeys YOLO", () => {
    expect(modeCommand(target, "bypassPermissions")).toBeNull();
    expect(modeBody(wire({ cardId: "c", mode: "bypassPermissions" }))).toBeNull();
    expect(modeBody(wire(null))).toBeNull();
  });

  it("carries Auto both ways", () => {
    const row = modeCommand(target, "auto");
    expect(row).toMatchObject({ kind: "mode", target_device: "worker:w" });
    expect(modeBody(wire(row?.payload))).toEqual({ cardId: "c", mode: "auto" });
  });

  it("round-trips a tap and a swipe, and drops anything else", () => {
    const tap = inputCommand(target, { kind: "tap", device: "d", x: 0.1, y: 0.2 });
    expect(inputBody(wire(tap?.payload))).toEqual({ cardId: "c", input: { kind: "tap", device: "d", x: 0.1, y: 0.2 } });
    const swipe = inputCommand(target, { kind: "swipe", device: "d", x: 0, y: 0, x2: 1, y2: 1, ms: 200 });
    expect(inputBody(wire(swipe?.payload))?.input).toMatchObject({ kind: "swipe", x2: 1, ms: 200 });
    expect(inputCommand(target, { kind: "live", device: "d", x: 0, y: 0 })).toBeNull();
    expect(inputCommand(target, { kind: "swipe", device: "d", x: 0, y: 0 })).toBeNull();
    expect(inputCommand(target, null)).toBeNull();
    expect(inputBody(wire({ kind: "tap", device: "d", x: 0, y: 0 }))).toBeNull();
  });
});
