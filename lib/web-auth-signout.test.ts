// lib/web-auth.ts: webSignOut (the /auth/sign-out route's body). The pure
// helpers and readWebSessionIdentity live in web-auth.test.ts; sign-in
// (startWebSignIn) and the callback (finishWebSignIn) live beside this file.
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

describe("webSignOut", () => {
  it("calls signOut with scope:'local' and returns the /login URL", async () => {
    const { webSignOut } = await load();
    const client = buildClient();
    client.auth.signOut.mockResolvedValue({ error: null });
    const result = await webSignOut(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/sign-out"),
      loginPath: "/login",
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/login" });
  });
});
