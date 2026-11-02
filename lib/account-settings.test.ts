import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// This Mac's account settings, pushed to your own account_settings row for your workers to mirror.
vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const snapshot = { pushOnDone: false, threadPrompt: "" };
vi.mock("./host-settings", () => ({ accountSettings: vi.fn(() => ({ ...snapshot })) }));

vi.mock("./browser-shell", () => ({ shell: vi.fn(() => Promise.reject(new Error("The browser pane only exists in the desktop app"))) }));

const { forgetPushedSettings, pushAccountSettings: push, startAccountSettingsPush } = await import("./account-settings");
const { accountSettingsMessage, settingsDigest } = await import("./account-settings-sig");
const shell = (await import("./browser-shell")).shell;

// Main signs over the message lib/account-settings-sig.ts builds; here a fake that says what it was asked.
const sign = vi.fn((body: { userId: string; version: number; digest: string }) => Promise.resolve({ signature: `sig:${accountSettingsMessage(body.userId, body.version, body.digest)}` }));
const pushAccountSettings = (c?: SupabaseClient) => push(c, sign);

function client({ user = "u-1", error = null, throws = false }: { user?: string | null; error?: { message: string } | null; throws?: boolean } = {}) {
  const upsert = vi.fn(() => Promise.resolve({ error }));
  const c = {
    auth: { getSession: () => (throws ? Promise.reject(new Error("offline")) : Promise.resolve({ data: { session: user ? { user: { id: user } } : null } })) },
    from: vi.fn(() => ({ upsert })),
  } as unknown as SupabaseClient;
  return { c, upsert };
}

beforeEach(() => {
  forgetPushedSettings();
  snapshot.pushOnDone = false;
});
afterEach(() => vi.useRealTimers());

describe("pushAccountSettings", () => {
  it("writes your own row, then sends nothing again until a setting changes", async () => {
    const { c, upsert } = client();
    expect(await pushAccountSettings(c)).toBe(true);
    const settings = { pushOnDone: false, threadPrompt: "" };
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u-1", settings }));
    const { version, signature } = (upsert.mock.calls[0] as unknown as [{ version: number; signature: string }])[0];
    expect(signature).toBe(`sig:${accountSettingsMessage("u-1", version, settingsDigest(settings))}`);
    expect(await pushAccountSettings(c)).toBe(false);
    snapshot.pushOnDone = true;
    expect(await pushAccountSettings(c)).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(2);
    const versions = (upsert.mock.calls as unknown as [{ version: number }][]).map(([row]) => row.version);
    expect(versions[1]).toBeGreaterThan(versions[0] as number);
  });

  it("pushes nothing it couldn't sign: outside the desktop app, or main gave no signature", async () => {
    const { c, upsert } = client();
    expect(await push(c)).toBe(false);
    expect(shell).toHaveBeenCalledWith("/account-settings/sign", expect.objectContaining({ userId: "u-1", digest: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown }));
    expect(await push(c, () => Promise.resolve({}))).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes again for someone else signed in, though nothing changed", async () => {
    const first = client({ user: "u-1" });
    expect(await pushAccountSettings(first.c)).toBe(true);
    const other = client({ user: "u-2" });
    expect(await pushAccountSettings(other.c)).toBe(true);
    expect(other.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u-2" }));
  });

  it("does nothing signed out, and says nothing when the database refuses or the network is down", async () => {
    expect(await pushAccountSettings(client({ user: null }).c)).toBe(false);
    const refused = client({ error: { message: "no such table" } });
    expect(await pushAccountSettings(refused.c)).toBe(false);
    // A refused push isn't remembered, so the next one tries again.
    expect(await pushAccountSettings(refused.c)).toBe(false);
    expect(refused.upsert).toHaveBeenCalledTimes(2);
    expect(await pushAccountSettings(client({ throws: true }).c)).toBe(false);
  });
});

describe("startAccountSettingsPush", () => {
  it("pushes once a little after start, unless stopped first", () => {
    vi.useFakeTimers();
    const push = vi.fn(() => Promise.resolve());
    startAccountSettingsPush(push);
    vi.advanceTimersByTime(20_000);
    expect(push).toHaveBeenCalledTimes(1);
    const stop = startAccountSettingsPush(push);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("the default client", () => {
  it("is the account's, and one that can't be made pushes nothing", async () => {
    expect(await push()).toBe(false);
  });
});
