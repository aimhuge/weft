import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newSealKeys } from "./worker-seal";

// sendLogin (lib/workers-account.ts): Settings → Sync → Workers' "Sign in to Claude".
vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-here" }));

const { sendLogin } = await import("./workers-account");
const TOKEN = ["sk-ant", "oat01", "abcdefghijklmnopqrstuvwxyz0123"].join("-");

let inserted: unknown[];
beforeEach(() => {
  inserted = [];
});

function fakeClient(opts: { user?: string | null; publicKey?: string | null; insertError?: { message: string } } = {}) {
  const query = {
    select: () => query,
    eq: () => query,
    insert: (row: unknown) => (inserted.push(row), query),
    maybeSingle: () => Promise.resolve({ data: opts.publicKey === undefined ? null : { public_key: opts.publicKey }, error: null }),
    single: () => Promise.resolve({ data: opts.insertError ? null : { id: "cmd-7" }, error: opts.insertError ?? null }),
  };
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: opts.user === null ? null : { user: { id: opts.user ?? "u-1" } } } }) },
    from: () => query,
  } as unknown as SupabaseClient;
}

describe("sendLogin", () => {
  it("seals the token to the worker's published key and inserts a login command", async () => {
    const client = fakeClient({ publicKey: newSealKeys().publicKey });
    expect(await sendLogin({ workerId: "w-1", token: TOKEN }, client)).toEqual({ commandId: "cmd-7" });
    expect(inserted[0]).toMatchObject({ org_id: "org-1", kind: "login", target_device: "worker:w-1" });
    expect(JSON.stringify(inserted[0])).not.toContain("sk-ant");
  });

  it("asks for an update when the worker has no key yet, or isn't one you can see", async () => {
    await expect(sendLogin({ workerId: "w-1", token: TOKEN }, fakeClient({ publicKey: null }))).rejects.toThrow("hasn't published its key yet");
    await expect(sendLogin({ workerId: "w-1", token: TOKEN }, fakeClient())).rejects.toThrow("hasn't published its key yet");
  });

  it("refuses a token that isn't one, and says when the insert fails", async () => {
    const publicKey = newSealKeys().publicKey;
    await expect(sendLogin({ workerId: "w-1", token: "nope" }, fakeClient({ publicKey }))).rejects.toThrow("starts with sk-ant-");
    await expect(sendLogin({ workerId: "w-1", token: TOKEN }, fakeClient({ publicKey, insertError: { message: "denied" } }))).rejects.toThrow("Couldn't send the sign-in: denied");
  });

  it("needs you signed in", async () => {
    await expect(sendLogin({ workerId: "w-1", token: TOKEN }, fakeClient({ user: null }))).rejects.toThrow("Sign in to Weft");
  });
});
