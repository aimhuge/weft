// electron/app-setup.cjs: wires the three mini-app modules (app-data, app-data-fetch,
// app-secrets-push) plus the sealed-account store, in the same order main.cjs used to do
// inline. The test stands up the real modules against a temp data dir, with the vault,
// pane ownership check and account getter stubbed, and asserts which IPC channels got
// registered — the same shape app-data.test.ts and app-secrets-push.test.ts use.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupApps } from "./app-setup.cjs";

function makeDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-setup-"));
  fs.mkdirSync(path.join(dir, "apps", "growth"), { recursive: true });
  return dir;
}

type IpcEvent = { sender?: { id?: string }; senderFrame?: { url?: string } };
type Handler = (event: IpcEvent, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const ipcMain = { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } };

function goodVault() {
  return {
    confirm: vi.fn(() => Promise.resolve(true)),
    addBlanks: vi.fn(),
    valuesFor: vi.fn(() => Promise.resolve({ label: "you/repo", values: {}, missing: [] })),
    names: vi.fn(() => Promise.resolve({ label: "you/repo", secrets: [] })),
  };
}

const safeStorage = { isEncryptionAvailable: () => true };

interface WebContentsLike {
  id?: string;
}

interface SenderLike {
  id?: string;
}

let dataDir: string;
let vault: ReturnType<typeof goodVault>;
let ownsPane: (wc: WebContentsLike | null | undefined) => boolean;
let isBoard: (sender: SenderLike | null | undefined) => boolean;
let readLink: (folder: string) => Promise<{ ref: string } | null>;
// The local server's address and launch token (electron/main.cjs). The live-data bridge reads
// it fresh on each call, because the server may not be up when setupApps runs.
let server: () => { url: string; token: string } | null;

beforeEach(() => {
  handlers.clear();
  dataDir = makeDataDir();
  vault = goodVault();
  // Only the board window id "b1" passes both gates; the default lets our handler
  // existence tests reach the real handlers without needing a real sender.
  ownsPane = vi.fn((wc: WebContentsLike | null | undefined): boolean => {
    if (!wc) return false;
    return wc.id === "b1";
  });
  isBoard = vi.fn((s: SenderLike | null | undefined): boolean => {
    if (!s) return false;
    return s.id === "b1";
  });
  readLink = vi.fn((): Promise<{ ref: string } | null> => Promise.resolve({ ref: "abcdefghijkl" }));
  server = vi.fn(() => ({ url: "http://127.0.0.1:1024", token: "tok" }));
});

afterEach(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

describe("setupApps", () => {
  it("registers the data reads, the hosted fetch/env/requestSecret, and the secrets push", () => {
    const { account } = setupApps({
      ipcMain,
      vault,
      ownsPane,
      isBoard,
      dataDir,
      supabaseReadLink: readLink,
      getSafeStorage: () => safeStorage,
      server,
    });
    expect(typeof account).toBe("function");
    // From app-data.cjs — env grant + reads:
    expect(handlers.has("app-data:access")).toBe(true);
    expect(handlers.has("app-data:request")).toBe(true);
    expect(handlers.has("app-data:revoke")).toBe(true);
    expect(handlers.has("app-data:read")).toBe(true);
    // From app-data-fetch.cjs — hosted fetch / env / requestSecret:
    expect(handlers.has("app-data:fetch")).toBe(true);
    expect(handlers.has("app-data:env")).toBe(true);
    expect(handlers.has("app-data:request-secret")).toBe(true);
    // From app-secrets-push.cjs — Share dialog's "Upload secrets":
    expect(handlers.has("apps:push-secrets")).toBe(true);
    // From live-data.cjs — a file: page reading a live snapshot off Weft's own server:
    expect(handlers.has("live-data:read")).toBe(true);
  });

  it("binds the push's confirm to vault.confirm", async () => {
    setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server });
    // A "stranger" sender must be rejected before push runs (the board check is from
    // app-secrets-push.cjs, not from setupApps itself, so confirm must be a forwarder).
    await expect(handlers.get("apps:push-secrets")!({ sender: { id: "stranger" } }, "app-1")).rejects.toThrow(/only answers the board window/);
    expect(vault.confirm).not.toHaveBeenCalled();
    // When the board is the sender, the push runs and reaches vault.confirm on its
    // "no such app" path (no app by that id → no Touch ID asked).
    await handlers.get("apps:push-secrets")!({ sender: { id: "b1" } }, "nope");
    expect(vault.confirm).not.toHaveBeenCalled();
  });

  it("returns an account getter that lazily creates the sealed store via getSafeStorage", () => {
    let getSafeStorageCalls = 0;
    const getSafeStorage = () => {
      getSafeStorageCalls++;
      return safeStorage;
    };
    const { account } = setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage, server });
    // The store isn't built until the first read — same lazy pattern main.cjs used to use.
    expect(getSafeStorageCalls).toBe(0);
    const session = account();
    // No sealed.json on disk yet and no .plain either → reads as signed-out {}.
    expect(session).toEqual({});
    expect(getSafeStorageCalls).toBe(1);
    // The same store instance is reused on subsequent reads.
    account();
    expect(getSafeStorageCalls).toBe(1);
  });

  it("registers handlers that refuse senders outside the pane (data reads) and outside the board (push)", async () => {
    setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server });
    // The defaults in beforeEach already make ownsPane and isBoard picky; a stranger sender
    // can't reach the real handlers.
    await expect(handlers.get("app-data:access")!({ sender: { id: "x" }, senderFrame: { url: "file:///nope" } })).rejects.toThrow();
    await expect(handlers.get("apps:push-secrets")!({ sender: { id: "x" } }, "app-1")).rejects.toThrow(/only answers the board window/);
  });

  it("throws when required deps are missing and registers nothing", () => {
    expect(() => setupApps({
      ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage,
      server,
    })).not.toThrow();
    handlers.clear();
    expect(() => setupApps({ ipcMain: undefined, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server })).toThrow(/ipcMain/);
    expect(() => setupApps({ ipcMain, vault: undefined, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server })).toThrow(/vault/);
    expect(() => setupApps({ ipcMain, vault, ownsPane: undefined, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server })).toThrow(/ownsPane/);
    expect(() => setupApps({ ipcMain, vault, ownsPane, isBoard: undefined, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server })).toThrow(/isBoard/);
    expect(() => setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir: "", supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server })).toThrow(/dataDir/);
    expect(() => setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: undefined, getSafeStorage: () => safeStorage, server })).toThrow(/supabaseReadLink/);
    expect(() => setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: undefined, server })).toThrow(/getSafeStorage/);
    expect(() => setupApps({ ipcMain, vault, ownsPane, isBoard, dataDir, supabaseReadLink: readLink, getSafeStorage: () => safeStorage, server: undefined })).toThrow(/server/);
    expect(handlers.size).toBe(0);
  });
});
