// lib/web-auth.ts: the profile bump finishWebSignIn does after the exchange
// (last_login_at / login_count through the service client). It is best-effort:
// a failure there must not block sign-in. The exchange itself lives in
// web-auth-callback.test.ts; the GitHub details in web-auth-github.test.ts.
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

describe("the profile bump after the exchange", () => {
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
});
