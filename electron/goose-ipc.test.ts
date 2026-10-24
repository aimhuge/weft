// electron/goose-ipc.cjs: the two doors into Goose's keys. The board's door answers with hasKey and the metadata,
// never a key. The server's door hands out a one-time grant, not the key itself — the key only reaches a subprocess
// through electron/goose-env.cjs, which claims the grant.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGoose, gooseRoutes, registerGoose } from "./goose-ipc.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-ipc-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const make = (dir: string, now = () => Date.now()) => createGoose({ dataDir: dir, safeStorage, now });

describe("listProviders", () => {
  it("lists the catalog, with no key saved", () => {
    const goose = make(tmp());
    const view = goose.listProviders();
    expect(view.providers.length).toBeGreaterThan(5);
    expect(view.providers.every((p) => !p.hasKey)).toBe(true);
  });

  it("never holds a key, before or after one is saved", () => {
    const goose = make(tmp());
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc123" });
    const view = goose.listProviders();
    const row = view.providers.find((p) => p.id === "openrouter");
    expect(row?.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk-or-abc123");
    expect(Object.keys(row ?? {})).not.toContain("token");
  });
});

describe("setProviderKey", () => {
  it("saves the key and answers with the metadata, not the key", () => {
    const goose = make(tmp());
    const saved = goose.setProviderKey({ providerId: "custom", token: "sk-custom", baseUrl: "https://api.example.com/v1", model: "my-model" });
    expect(saved.hasKey).toBe(true);
    expect(saved.baseUrl).toBe("https://api.example.com/v1");
    expect(saved.model).toBe("my-model");
    expect(JSON.stringify(saved)).not.toContain("sk-custom");
  });

  it("refuses a provider it doesn't know", () => {
    const goose = make(tmp());
    expect(() => goose.setProviderKey({ providerId: "nope", token: "abc" })).toThrow(/doesn't know a provider called "nope"/);
  });
});

describe("forgetProviderKey", () => {
  it("removes the key and says whether there was one", () => {
    const goose = make(tmp());
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc" });
    expect(goose.forgetProviderKey({ providerId: "openrouter" })).toEqual({ id: "openrouter", removed: true });
    expect(goose.forgetProviderKey({ providerId: "openrouter" })).toEqual({ id: "openrouter", removed: false });
    expect(goose.listProviders().providers.find((p) => p.id === "openrouter")?.hasKey).toBe(false);
  });
});

describe("the grant", () => {
  it("hands out a grant, not the key", () => {
    const goose = make(tmp());
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc123" });
    const grant = goose.grantEnv({ providerId: "openrouter" });
    expect(grant.grant).toBeTruthy();
    expect(grant.names).toEqual(["OPENROUTER_API_KEY"]);
    expect(grant.model).toBe("anthropic/claude-sonnet-4.5");
    expect(JSON.stringify(grant)).not.toContain("sk-or-abc123");
  });

  it("claims once: the key comes out of it, and it is spent", () => {
    const goose = make(tmp());
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc123" });
    const { grant } = goose.grantEnv({ providerId: "openrouter" });
    expect(goose.claim(grant)).toEqual({ env: { OPENROUTER_API_KEY: "sk-or-abc123" } });
    expect(() => goose.claim(grant)).toThrow(/already used or has expired/);
  });

  it("expires", () => {
    let now = 1000;
    const goose = make(tmp(), () => now);
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc123" });
    const { grant } = goose.grantEnv({ providerId: "openrouter" });
    now += 61_000;
    expect(() => goose.claim(grant)).toThrow(/already used or has expired/);
  });

  it("refuses when there's no key saved for the provider", () => {
    const goose = make(tmp());
    expect(() => goose.grantEnv({ providerId: "openrouter" })).toThrow(/no OpenRouter key saved/);
  });

  it("refuses a provider it doesn't know", () => {
    const goose = make(tmp());
    expect(() => goose.grantEnv({ providerId: "nope" })).toThrow(/doesn't know a provider called "nope"/);
  });
});

describe("the IPC handlers", () => {
  it("answer the board window only", async () => {
    const goose = make(tmp());
    const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => handlers.set(channel, fn) };
    const board = {};
    registerGoose(ipcMain, { goose, isBoard: (sender: unknown) => sender === board });

    expect(handlers.has("goose:list-providers")).toBe(true);
    expect(handlers.has("goose:set-provider-key")).toBe(true);
    expect(handlers.has("goose:forget-provider-key")).toBe(true);

    await expect(handlers.get("goose:list-providers")!({ sender: {} })).rejects.toThrow(/only answers the board window/);
    const view = (await handlers.get("goose:list-providers")!({ sender: board })) as { providers: unknown[] };
    expect(Array.isArray(view.providers)).toBe(true);
  });
});

describe("the control-server routes", () => {
  it("grant and claim, with no plaintext crossing them", async () => {
    const goose = make(tmp());
    goose.setProviderKey({ providerId: "openrouter", token: "sk-or-abc123" });
    const routes = gooseRoutes(goose);
    const grant = (await routes["POST /goose/env-grant"]({ providerId: "openrouter" })) as { grant: string };
    expect(JSON.stringify(grant)).not.toContain("sk-or-abc123");
    const claimed = (await routes["POST /goose/env-claim"]({ grant: grant.grant })) as { env: Record<string, string> };
    expect(claimed.env.OPENROUTER_API_KEY).toBe("sk-or-abc123");
  });
});
