import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAccountClient as makeClient, decodeClaims as claimsOf } from "./account-client.cjs";

// The module is CommonJS with no types of its own, so the shapes it hands back are described here.
// (electron/*.d.cts carries the same job for the other Electron modules.)
interface Keychain {
  isEncryptionAvailable: () => boolean;
  encryptString: (text: string) => Buffer;
  decryptString: (buf: Buffer) => string;
}

// The bits of supabase-js the account client uses: a table query, an auth refresh, and the fetch.
interface FakeSupabase {
  from: (table: string) => { select: (columns: string) => Promise<{ data: unknown; error: { message: string } | null }> };
  auth: { refreshSession: () => Promise<{ data: { session: unknown } | null; error: { message: string } | null }> };
  fetch: (input: unknown, init?: { headers?: Headers | Record<string, string> }) => Promise<Response>;
}

interface AccountClient {
  read: () => Record<string, string>;
  write: (data: Record<string, string>) => void;
  getClaims: () => Record<string, unknown> | null;
  signedIn: () => boolean;
  readonly supabase: FakeSupabase;
}

interface ClientOptions {
  dataDir: string;
  safeStorage: Keychain | (() => Keychain);
  url?: string;
  key?: string;
  createClient?: (url: string, key: string, options: { global: { fetch: unknown } }) => FakeSupabase;
  fetch?: (input: unknown, init?: { headers?: Headers | Record<string, string> }) => Promise<Response>;
}

const createAccountClient = (options: ClientOptions): AccountClient => makeClient(options);
const decodeClaims = (token: string | null): Record<string, unknown> | null => claimsOf(token);

// safeStorage stand-in: reversible, but not the identity, so a test can tell the bytes were sealed.
const safeStorage = (available = true): Keychain => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decryptString: (buf: Buffer) => Buffer.from(buf.toString().slice("sealed:".length), "base64").toString(),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-acct-client-"));

// supabase-js hands its fetch a Headers instance; the auth client hands it a plain object. Both.
const authOf = (init?: { headers?: Headers | Record<string, string> }) => {
  const headers = init?.headers;
  if (!headers) return null;
  return headers instanceof Headers ? headers.get("Authorization") : headers.Authorization ?? null;
};

// A JWT whose payload says who the user is. The signature is never checked locally.
const jwt = (claims: Record<string, unknown>) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.signature`;
};

const SESSION = {
  access_token: jwt({ sub: "user-1", email: "sam@example.com" }),
  refresh_token: "rt-1",
  expires_at: 1_900_000_000,
  user: { id: "user-1", email: "sam@example.com" },
};

// The session as it sits in the sealed file, read back.
const sessionOf = (client: AccountClient) => JSON.parse(client.read()["weft-auth"]!) as { refresh_token: string };

// A supabase-js stand-in: it takes the fetch the account client hands it and hands it back.
const fakeSupabase = (options: { global: { fetch: unknown } }, refresh: () => Promise<{ data: { session: unknown } | null; error: { message: string } | null }>) =>
  ({
    from: () => ({ select: () => Promise.resolve({ data: null, error: null }) }),
    auth: { refreshSession: refresh },
    fetch: options.global.fetch,
  }) as unknown as FakeSupabase;

describe("createAccountClient", () => {
  it("keeps the session sealed, and a write changes the sealed file", () => {
    const dir = tmp();
    const client = createAccountClient({ dataDir: path.join(dir, "data"), safeStorage: safeStorage() });
    const sealed = path.join(dir, "data", "account.sealed");

    expect(client.read()).toEqual({});
    client.write({ "weft-auth": JSON.stringify(SESSION) });

    // The tokens are in the file, but sealed: nobody reading the bytes gets them.
    const bytes = fs.readFileSync(sealed, "utf8");
    expect(bytes).not.toContain("rt-1");
    expect(bytes).not.toContain("user-1");
    expect(fs.statSync(sealed).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, "data", "account.json"))).toBe(false);

    // read → mutate → read: the second read sees the mutation, and the sealed file changed.
    const before = fs.readFileSync(sealed);
    expect(sessionOf(client).refresh_token).toBe("rt-1");
    client.write({ "weft-auth": JSON.stringify({ ...SESSION, refresh_token: "rt-2" }) });
    expect(sessionOf(client).refresh_token).toBe("rt-2");
    expect(fs.readFileSync(sealed).equals(before)).toBe(false);
  });

  it("reads the claims of the signed-in user, and none when signed out", () => {
    const dir = tmp();
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage() });
    expect(client.getClaims()).toBeNull();
    expect(client.signedIn()).toBe(false);

    client.write({ "weft-auth": JSON.stringify(SESSION) });
    expect(client.getClaims()).toMatchObject({ sub: "user-1", email: "sam@example.com" });
    expect(client.signedIn()).toBe(true);
  });

  it("makes its client on first use, and keeps the same one", () => {
    const dir = tmp();
    const made = vi.fn(() => fakeSupabase({ global: { fetch: vi.fn() } }, () => Promise.resolve({ data: null, error: null })));
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage(), createClient: made });

    // Lazy: nothing is built until the client is asked for.
    expect(made).not.toHaveBeenCalled();
    expect(client.supabase).toBeTruthy();
    expect(made).toHaveBeenCalledTimes(1);
    expect(client.supabase).toBe(client.supabase);
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("asks for the Keychain only when it needs it, so main can start before the app is ready", () => {
    const dir = tmp();
    let asked = 0;
    const client = createAccountClient({
      dataDir: dir,
      safeStorage: () => {
        asked++;
        return safeStorage();
      },
    });
    expect(asked).toBe(0);
    client.write({ "weft-auth": JSON.stringify(SESSION) });
    expect(asked).toBeGreaterThan(0);
    expect(sessionOf(client).refresh_token).toBe("rt-1");
  });

  it("never puts the service role in the client, and reads the published key", () => {
    const dir = tmp();
    const made = vi.fn((_url: string, _key: string, options: { global: { fetch: unknown } }) => fakeSupabase(options, () => Promise.resolve({ data: null, error: null })));
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage(), createClient: made, key: "sb_publishable_test" });
    expect(client.supabase).toBeTruthy();
    const [, key, options] = made.mock.calls[0]!;
    expect(key).toBe("sb_publishable_test");
    expect(key).not.toContain("secret");
    expect(JSON.stringify(options)).not.toContain("service_role");
  });

  it("answers a signed-out request with a clean error instead of going out", async () => {
    const dir = tmp();
    const call = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const made = vi.fn((_url: string, _key: string, options: { global: { fetch: unknown } }) => fakeSupabase(options, () => Promise.resolve({ data: null, error: null })));
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage(), createClient: made, fetch: call });

    const response = await client.supabase.fetch("https://example.supabase.co/rest/v1/vaults");
    expect(response.status).toBe(401);
    expect(call).not.toHaveBeenCalled();
  });

  it("refreshes on a 401, retries with the new token, and keeps it in the sealed file", async () => {
    const dir = tmp();
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage() });
    client.write({ "weft-auth": JSON.stringify(SESSION) });

    const refreshed = { ...SESSION, access_token: jwt({ sub: "user-1" }), refresh_token: "rt-2" };
    const seen: { url: string; auth: string | null }[] = [];
    // The real supabase-js, talking to a fake Supabase: the first table read is refused with a 401, the
    // refresh answers with a new session, and the second read goes out with the new bearer token.
    const call = vi.fn((input: unknown, init?: { headers?: Headers | Record<string, string> }) => {
      const url = typeof input === "string" ? input : (input as { url: string }).url;
      seen.push({ url, auth: authOf(init) });
      if (url.includes("/auth/v1/token")) {
        return Promise.resolve(new Response(JSON.stringify({ ...refreshed, expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (seen.filter((s) => !s.url.includes("/auth/v1/")).length === 1) {
        return Promise.resolve(new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 }));
      }
      return Promise.resolve(new Response(JSON.stringify([{ id: "v1" }]), { status: 200, headers: { "content-type": "application/json" } }));
    });

    const withFetch = createAccountClient({ dataDir: dir, safeStorage: safeStorage(), fetch: call });
    const { data, error } = await withFetch.supabase.from("vaults").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "v1" }]);

    // The retry carried the refreshed token, and the new session landed in the sealed file.
    const reads = seen.filter((s) => !s.url.includes("/auth/v1/"));
    expect(reads).toHaveLength(2);
    expect(reads[0]!.auth).toBe(`Bearer ${SESSION.access_token}`);
    expect(reads[1]!.auth).toBe(`Bearer ${refreshed.access_token}`);
    expect(sessionOf(client).refresh_token).toBe("rt-2");
    // And the sealed bytes still hold no token in the clear.
    expect(fs.readFileSync(path.join(dir, "account.sealed"), "utf8")).not.toContain("rt-2");
  });

  it("gives up on the 401 when there is no refresh token to use", async () => {
    const dir = tmp();
    const client = createAccountClient({ dataDir: dir, safeStorage: safeStorage() });
    client.write({ "weft-auth": JSON.stringify({ ...SESSION, refresh_token: "" }) });

    const call = vi.fn(() => Promise.resolve(new Response("{}", { status: 401 })));
    const withFetch = createAccountClient({ dataDir: dir, safeStorage: safeStorage(), fetch: call });
    const response = await withFetch.supabase.fetch("https://example.supabase.co/rest/v1/vaults");
    expect(response.status).toBe(401);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("decodeClaims", () => {
  it("reads the payload of a JWT, and nothing from a broken one", () => {
    expect(decodeClaims(jwt({ sub: "u1" }))).toEqual({ sub: "u1" });
    expect(decodeClaims("")).toBeNull();
    expect(decodeClaims(null)).toBeNull();
    expect(decodeClaims("not-a-jwt")).toBeNull();
    expect(decodeClaims("a.!!!.c")).toBeNull();
    expect(decodeClaims("a.bm90LWpzb24.c")).toBeNull();
  });
});
