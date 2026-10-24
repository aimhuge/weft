// lib/web-auth.ts: the GitHub login and token finishWebSignIn hands back for
// the Open Source check (lib/billing/oss-grant.ts). The exchange itself lives
// in web-auth-callback.test.ts; the profile bump in web-auth-profile.test.ts.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const webClient = vi.fn();
const webUser = vi.fn();
const serviceClient = vi.fn();
vi.mock("./web-session", () => ({ webClient, webUser, serviceClient }));

async function load() {
  vi.resetModules();
  return import("./web-auth");
}

function makeRequest(url: string) {
  return new Request(url);
}

type ClientMock = {
  auth: {
    exchangeCodeForSession: Mock;
    getUser: Mock;
  };
  from: Mock;
};

function buildClient(): ClientMock {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(),
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

describe("the GitHub details of a fresh session", () => {
  it("hands back the GitHub login and token of a fresh session", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: null,
      data: {
        session: {
          provider_token: "gho_token",
          user: { id: "u1", user_metadata: { user_name: "jane" } },
        },
      },
    });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({
      kind: "redirect",
      url: "https://weft.zip/team",
      github: { userId: "u1", login: "jane", token: "gho_token" },
    });
  });

  it("hands back a null token when the session carries none", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { user: { id: "u1", user_metadata: { user_name: "jane" } } } },
    });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({
      kind: "redirect",
      url: "https://weft.zip/team",
      github: { userId: "u1", login: "jane", token: null },
    });
  });

  it("leaves the GitHub details out when the session has no user id", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { provider_token: "gho_token", user: { user_metadata: { user_name: "jane" } } } },
    });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });

  it("leaves the GitHub details out when the session has no GitHub login", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { provider_token: "gho_token", user: { id: "u1", user_metadata: {} } } },
    });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });

  it("leaves the GitHub details out when the login isn't a string", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { provider_token: "gho_token", user: { id: "u1", user_metadata: { user_name: 42 } } } },
    });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });

  it("leaves the GitHub details out when the session is empty", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null, data: { session: null } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });
});
