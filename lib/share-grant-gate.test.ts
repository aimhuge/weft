import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { grantAdmits, grantCanAnswer } from "./share-grant-gate";

// lib/share-grant-gate.ts: which refusals a grant can answer, and the share_grant_admits RPC, failing closed.

vi.mock("server-only", () => ({}));

const user = { id: "u1", email: "x@y", name: null, avatar: null };
const svc = (answer: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve(answer));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("grantCanAnswer", () => {
  it("answers sign-in, not-a-member and gate refusals only", () => {
    expect(grantCanAnswer("login")).toBe(true);
    expect(grantCanAnswer("denied")).toBe(true);
    expect(grantCanAnswer("gate")).toBe(true);
    expect(grantCanAnswer("missing")).toBe(false);
    expect(grantCanAnswer("unconfigured")).toBe(false);
  });
});

describe("grantAdmits", () => {
  it("is false with no service client or no visitor", async () => {
    const { client, rpc } = svc({ data: true, error: null });
    expect(await grantAdmits(null, "sh1", user)).toBe(false);
    expect(await grantAdmits(client, "sh1", null)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks share_grant_admits for the share and the visitor", async () => {
    const { client, rpc } = svc({ data: true, error: null });
    expect(await grantAdmits(client, "sh1", user)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("share_grant_admits", { share: "sh1", uid: "u1" });
  });

  it("is false when the RPC says no or answers something else", async () => {
    expect(await grantAdmits(svc({ data: false, error: null }).client, "sh1", user)).toBe(false);
    expect(await grantAdmits(svc({ data: "true", error: null }).client, "sh1", user)).toBe(false);
  });

  it("fails closed and logs on an RPC error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await grantAdmits(svc({ data: true, error: { message: "boom" } }).client, "sh1", user)).toBe(false);
    expect(err).toHaveBeenCalledWith("share-grant-gate: boom");
  });
});
