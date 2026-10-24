// lib/web-auth.ts: finishWebSignIn (the /auth/callback route's body). The pure
// helpers and readWebSessionIdentity live in web-auth.test.ts; sign-in
// (startWebSignIn) and sign-out (webSignOut) live beside this file.
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const webClient = vi.fn();
const webUser = vi.fn();
const serviceClient = vi.fn();
const isWebEnabled = vi.fn();
vi.mock("./web-session", () => ({ webClient, webUser, serviceClient }));
vi.mock("./home", () => ({ isWebEnabled }));

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

// Builds a service-client-shaped `from()` whose `.update().eq()` and
// `.select().eq().single()` chains return what the test asks for. The order
// of update calls is `last_login_at` first, `login_count` second.
function buildService(steps: {
  stampError?: { message: string };
  row?: { login_count: number } | null;
  readError?: { message: string };
  countError?: { message: string };
}) {
  const update = vi.fn();
  const select = vi.fn();
  const single = vi.fn().mockResolvedValue({ data: steps.row ?? null, error: steps.readError ?? null });
  const calls: Array<{ error: { message: string } | null }> = [
    { error: steps.stampError ?? null },
    { error: steps.countError ?? null },
  ];
  update.mockImplementation(() => ({
    eq: () => {
      const next = calls.shift();
      return Promise.resolve(next ? { error: next.error } : { error: null });
    },
  }));
  select.mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) });
  const from = vi.fn().mockImplementation((table: string) => {
    if (table !== "profiles") throw new Error(`unexpected table ${table}`);
    return { update, select };
  });
  return { from, update, select, single };
}

beforeEach(() => {
  vi.clearAllMocks();
  isWebEnabled.mockReturnValue(true);
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

  it("redirects to a sanitized `next` on success and bumps the profile when the service client exists", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const svc = buildService({ row: { login_count: 3 } });
    serviceClient.mockReturnValue(svc);
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=%2Fteam"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    expect(svc.from).toHaveBeenCalledWith("profiles");
    expect(svc.update).toHaveBeenCalledTimes(2);
    const first = svc.update.mock.calls[0]?.[0] as { last_login_at: unknown } | undefined;
    const second = svc.update.mock.calls[1]?.[0] as { login_count: number } | undefined;
    expect(typeof first?.last_login_at).toBe("string");
    expect(second?.login_count).toBe(4);
  });

  it("falls back to the default `next` when the value is off-origin", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=" + encodeURIComponent("//evil.com/x")),
      code: "ok",
      providerError: null,
      next: "//evil.com/x",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });

  it("ignores a missing service client (no env key) and still signs in", async () => {
    const { finishWebSignIn } = await load();
    serviceClient.mockReturnValue(null);
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it("ignores a missing user (no getUser response) and still signs in", async () => {
    const { finishWebSignIn } = await load();
    serviceClient.mockReturnValue({ from: vi.fn() });
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: null } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
  });

  it("logs and continues when the profile bump fails (stamp write errors)", async () => {
    const { finishWebSignIn } = await load();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = buildService({ stampError: { message: "boom" } });
    serviceClient.mockReturnValue(svc);
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("falls back to login_count=1 when the profile row is missing or has no count", async () => {
    const { finishWebSignIn } = await load();
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const svc = buildService({ row: null });
    serviceClient.mockReturnValue(svc);
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    const second = svc.update.mock.calls[1]?.[0] as { login_count: number } | undefined;
    expect(second?.login_count).toBe(1);
  });

  it("logs and continues when reading the count errors", async () => {
    const { finishWebSignIn } = await load();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = buildService({ readError: { message: "db down" } });
    serviceClient.mockReturnValue(svc);
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("logs and continues when the count write errors", async () => {
    const { finishWebSignIn } = await load();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = buildService({ row: { login_count: 5 }, countError: { message: "db down" } });
    serviceClient.mockReturnValue(svc);
    const client = buildClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await finishWebSignIn(client as unknown as SupabaseClient, {
      request: makeRequest("https://weft.zip/auth/callback?code=ok&next=/team"),
      code: "ok",
      providerError: null,
      next: "/team",
      defaultNext: "/team",
    });
    expect(result).toEqual({ kind: "redirect", url: "https://weft.zip/team" });
    expect(consoleSpy).toHaveBeenCalled();
  });

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
