// lib/web-auth.ts: finishWebSignIn (the /auth/callback route's body) — the
// OAuth exchange itself. The pure helpers and readWebSessionIdentity live in
// web-auth.test.ts; sign-in (startWebSignIn) and sign-out (webSignOut) live
// beside this file; what happens after the exchange (the profile bump and the
// GitHub details) lives in web-auth-profile.test.ts and web-auth-github.test.ts.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const webClient = vi.fn();
const webUser = vi.fn();
const serviceClient = vi.fn();
const isWebEnabled = vi.fn((env: Record<string, string | undefined> = {}) =>
  Boolean(env.VERCEL || env.WEFT_HOME || env.WEFT_WEB),
);
const isDeployed = vi.fn((env: Record<string, string | undefined> = {}) =>
  Boolean(env.VERCEL || env.WEFT_HOME),
);
vi.mock("./web-session", () => ({ webClient, webUser, serviceClient }));
vi.mock("./home", () => ({ isWebEnabled, isDeployed }));

async function load() {
  vi.resetModules();
  return import("./web-auth");
}

function makeRequest(url: string) {
  return new Request(url);
}

type ClientMock = {
  auth: {
    signInWithOAuth: Mock;
    exchangeCodeForSession: Mock;
    signOut: Mock;
    getUser: Mock;
  };
  from: Mock;
};

function buildClient(): ClientMock {
  return {
    auth: {
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
      getUser: vi.fn(),
    },
    from: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  webClient.mockResolvedValue({});
  webUser.mockResolvedValue(null);
  serviceClient.mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("finishWebSignIn", () => {
  it("returns kind:'error' reason:'provider' when the URL has ?error=", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?error=access_denied"),
      code: null,
      providerError: "access_denied",
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "provider" });
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("returns kind:'error' reason:'nocode' when no code and no error come back", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback"),
      code: null,
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "nocode" });
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("returns kind:'error' reason:'exchange' when exchangeCodeForSession returns an error", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=bad"),
      code: "bad",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "exchange", message: "bad code" });
  });

  it("returns kind:'error' reason:'exchange' when exchangeCodeForSession throws", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockRejectedValue(new Error("network"));
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=bad"),
      code: "bad",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "exchange", message: "network" });
  });

  it("returns kind:'error' reason:'exchange' with String(err) when a non-Error is thrown", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockRejectedValue("oops");
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=bad"),
      code: "bad",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "exchange", message: "oops" });
  });

});
