import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// This Mac's account settings, pushed to your own account_settings row for your workers to mirror.
vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const snapshot = { pushOnDone: false, threadPrompt: "" };
vi.mock("./host-settings", () => ({ accountSettings: vi.fn(() => ({ ...snapshot })) }));

const { forgetPushedSettings, pushAccountSettings, startAccountSettingsPush } = await import("./account-settings");

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
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u-1", settings: { pushOnDone: false, threadPrompt: "" } }));
    expect(await pushAccountSettings(c)).toBe(false);
    snapshot.pushOnDone = true;
    expect(await pushAccountSettings(c)).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(2);
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
    expect(await pushAccountSettings()).toBe(false);
  });
});
