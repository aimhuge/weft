// Push for a shared vault's values on this Mac only: the Touch ID that names them (electron/vault-shared-api.cjs) and
// its IPC channel (electron/vault-ipc.cjs). The store's side is electron/vault-local-only.test.ts.
import { describe, expect, it, vi } from "vitest";
import { createSharedApi, pushText, sharedHandlers } from "./vault-shared-api.cjs";
import { registerVault } from "./vault-ipc.cjs";
import { pushLocalSteps } from "./vault-push-local.cjs";

const DEV = "development";
const entries = [
  { name: "SUPABASE_SECRET_KEY", environment: "production" },
  { name: "GA4_PROPERTY_ID", environment: DEV },
  { name: "GA4_PROPERTY_ID", environment: "production" },
];

function api(found: { name: string; environment: string }[], allow = true) {
  const prompt = vi.fn(() => Promise.resolve(allow));
  const pushLocal = vi.fn(() => Promise.resolve({ pushed: found, kept: [], queued: 0 }));
  const localOnly = vi.fn(() => Promise.resolve({ label: "aimhuge/weft", entries: found }));
  const shared = createSharedApi({ readVault: () => Promise.reject(new Error("unused")), device: { publicKey: "pk" }, prompt, localOnly, pushLocal });
  return { shared, prompt, pushLocal, localOnly };
}

describe("pushLocal", () => {
  it("names every name and environment in one Touch ID, then pushes exactly those", async () => {
    const { shared, prompt, pushLocal } = api(entries);
    expect(await shared.pushLocal({ folder: "/w" })).toEqual({ pushed: entries, kept: [], queued: 0 });
    expect(prompt).toHaveBeenCalledWith("share SUPABASE_SECRET_KEY (production), GA4_PROPERTY_ID (development, production) from aimhuge/weft with your team");
    expect(pushLocal).toHaveBeenCalledWith("/w", entries);
  });

  it("pushes nothing without Touch ID", async () => {
    const { shared, pushLocal } = api(entries, false);
    expect(await shared.pushLocal({ folder: "/w" })).toEqual({ denied: true });
    expect(pushLocal).not.toHaveBeenCalled();
  });

  it("asks nothing when nothing is on this Mac only", async () => {
    const { shared, prompt } = api([]);
    expect(await shared.pushLocal({ folder: "/w" })).toEqual({ pushed: [], kept: [], queued: 0 });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("is one of the board's shared-vault calls", async () => {
    const pushLocal = vi.fn(() => Promise.resolve({ pushed: [] }));
    const handlers = sharedHandlers(() => Promise.resolve({ pushLocal }), () => null);
    await handlers.pushLocal({ folder: "/w" });
    expect(pushLocal).toHaveBeenCalledWith({ folder: "/w" });
  });

  it("writes each name once, with its environments", () => {
    expect(pushText([{ name: "A", environment: DEV }])).toBe("A (development)");
  });
});

describe("vault:push-local", () => {
  const board = {};
  const base = { grantPending: vi.fn(), declinePending: vi.fn(), requestJoin: vi.fn(), join: vi.fn(), shareLocal: vi.fn() };
  const ipc = () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    return { handlers, ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) } };
  };

  it("passes the folder through with the signed-in client", async () => {
    const { handlers, ipcMain } = ipc();
    const pushLocal = vi.fn(() => Promise.resolve({ denied: true }));
    const accountClient = { supabase: {} };
    registerVault(ipcMain, { vault: {}, isBoard: (s: unknown) => s === board, accountClient: () => accountClient, shared: { ...base, pushLocal } });
    expect(await handlers.get("vault:push-local")!({ sender: board }, "/w")).toEqual({ denied: true });
    expect(pushLocal).toHaveBeenCalledWith({ folder: "/w", accountClient });
  });

  it("isn't there in a shell whose shared API has no pushLocal", () => {
    const { handlers, ipcMain } = ipc();
    registerVault(ipcMain, { vault: {}, isBoard: () => true, accountClient: () => ({}), shared: base });
    expect(handlers.has("vault:push-local")).toBe(false);
  });
});

describe("pushLocalSteps", () => {
  it("reads the folder's vault, pushes through the store, logs a line per environment and reloads the drawer", async () => {
    const store = { localOnly: vi.fn(() => entries), pushLocal: vi.fn(() => Promise.resolve({ pushed: entries, kept: [], queued: 0 })) };
    const log = vi.fn();
    const onChange = vi.fn();
    const steps = pushLocalSteps({ idOf: () => Promise.resolve({ id: "github:aimhuge/weft", label: "aimhuge/weft" }), storeReady: () => Promise.resolve(store), log, onChange });
    expect(await steps.localOnly("/w")).toEqual({ label: "aimhuge/weft", entries });
    expect(await steps.pushLocal("/w", entries)).toMatchObject({ pushed: entries });
    expect(store.pushLocal).toHaveBeenCalledWith("github:aimhuge/weft", entries);
    expect(log.mock.calls.map((c) => (c as unknown as [{ names: string[]; environment: string }])[0])).toMatchObject([
      { action: "push", names: ["SUPABASE_SECRET_KEY", "GA4_PROPERTY_ID"], environment: "production" },
      { action: "push", names: ["GA4_PROPERTY_ID"], environment: "development" },
    ]);
    expect(onChange).toHaveBeenCalledWith("/w");
  });
});
