// lib/web-auth.ts: startWebSignIn (the /auth/sign-in route's body). The pure
// helpers and readWebSessionIdentity live in web-auth.test.ts; the callback
// (finishWebSignIn) and sign-out (webSignOut) live beside this file.
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

describe("startWebSignIn", () => {
  it("calls signInWithOAuth with the redirect URL and returns the provider URL", async () => {
    const { startWebSignIn } = await load();
    const client = buildClient();
    client.auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://github.com/login/oauth/authorize?state=…" },
      error: null,
    });
    const result = await startWebSignIn(client as unknown as SupabaseClient, {
      provider: "github",
      origin: "https://weft.zip",
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({
      kind: "redirect",
      url: "https://github.com/login/oauth/authorize?state=…",
    });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "https://weft.zip/auth/callback?next=%2Fteam",
        skipBrowserRedirect: true,
      },
    });
  });

  it("rejects an unknown provider with kind:'error' reason:'provider'", async () => {
    const { startWebSignIn } = await load();
    const client = buildClient();
    const result = await startWebSignIn(client as unknown as SupabaseClient, {
      provider: "twitter",
      origin: "https://weft.zip",
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "provider" });
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("returns kind:'error' reason:'auth-error' with the message when Supabase rejects", async () => {
    const { startWebSignIn } = await load();
    const client = buildClient();
    client.auth.signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: "rate limited" },
    });
    const result = await startWebSignIn(client as unknown as SupabaseClient, {
      provider: "github",
      origin: "https://weft.zip",
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "auth-error", message: "rate limited" });
  });

  it("returns kind:'error' reason:'missing-url' when Supabase has no URL", async () => {
    const { startWebSignIn } = await load();
    const client = buildClient();
    client.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
    const result = await startWebSignIn(client as unknown as SupabaseClient, {
      provider: "github",
      origin: "https://weft.zip",
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "error", reason: "missing-url" });
  });
});
