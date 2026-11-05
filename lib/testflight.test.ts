import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ascToken, inviteTester, splitName, testflightConfig, testflightPublicUrl, type TestflightConfig } from "./testflight";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });

const CFG: TestflightConfig = { issuerId: "issuer-1", keyId: "KEY123", privateKey: PEM, groupId: "group-9" };
const NOW = 1_700_000_000_000;

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;

describe("testflightPublicUrl", () => {
  it("accepts a TestFlight join link, trimmed", () => {
    expect(testflightPublicUrl({ TESTFLIGHT_PUBLIC_URL: "  https://testflight.apple.com/join/AbC123  " })).toBe("https://testflight.apple.com/join/AbC123");
  });

  it("rejects unset, empty and non-TestFlight links", () => {
    expect(testflightPublicUrl({})).toBeNull();
    expect(testflightPublicUrl({ TESTFLIGHT_PUBLIC_URL: "   " })).toBeNull();
    expect(testflightPublicUrl({ TESTFLIGHT_PUBLIC_URL: "https://evil.example/join/abc" })).toBeNull();
    expect(testflightPublicUrl({ TESTFLIGHT_PUBLIC_URL: "http://testflight.apple.com/join/abc" })).toBeNull();
    expect(testflightPublicUrl({ TESTFLIGHT_PUBLIC_URL: "https://testflight.apple.com/join/abc/extra" })).toBeNull();
  });

  it("reads process.env by default", () => {
    vi.stubEnv("TESTFLIGHT_PUBLIC_URL", "https://testflight.apple.com/join/Zed9");
    try {
      expect(testflightPublicUrl()).toBe("https://testflight.apple.com/join/Zed9");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("testflightConfig", () => {
  const env = { ASC_ISSUER_ID: " issuer-1 ", ASC_KEY_ID: " KEY123 ", ASC_PRIVATE_KEY: PEM, TESTFLIGHT_GROUP_ID: " group-9 " };

  it("reads and trims the four values", () => {
    expect(testflightConfig(env)).toEqual({ issuerId: "issuer-1", keyId: "KEY123", privateKey: PEM.trim(), groupId: "group-9" });
  });

  it("turns \\n escapes in a one-line env var back into newlines", () => {
    const oneLine = PEM.trim().replace(/\n/g, "\\n");
    expect(oneLine).not.toContain("\n");
    const cfg = testflightConfig({ ...env, ASC_PRIVATE_KEY: oneLine });
    expect(cfg?.privateKey).toBe(PEM.trim());
    // And the unescaped key is a usable key.
    expect(() => ascToken(cfg!, NOW)).not.toThrow();
  });

  it("is null when any value is missing or blank", () => {
    for (const name of Object.keys(env)) {
      expect(testflightConfig({ ...env, [name]: undefined })).toBeNull();
      expect(testflightConfig({ ...env, [name]: "  " })).toBeNull();
    }
    expect(testflightConfig({})).toBeNull();
  });

  it("reads process.env by default", () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    try {
      expect(testflightConfig()?.groupId).toBe("group-9");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("ascToken", () => {
  it("is an ES256 JWT App Store Connect can verify", () => {
    const [head, body, sig] = ascToken(CFG, NOW).split(".") as [string, string, string];
    expect(decode(head)).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    const iat = Math.floor(NOW / 1000);
    expect(decode(body)).toEqual({ iss: "issuer-1", iat, exp: iat + 600, aud: "appstoreconnect-v1" });
    const raw = Buffer.from(sig, "base64url");
    expect(raw).toHaveLength(64);
    expect(verify("sha256", Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw)).toBe(true);
    // A tampered payload fails.
    expect(verify("sha256", Buffer.from(`${head}.${body}x`), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw)).toBe(false);
  });

  it("uses the current time by default", () => {
    const before = Math.floor(Date.now() / 1000);
    const [, payload] = ascToken(CFG).split(".") as [string, string, string];
    const body = decode(payload);
    expect(body.iat).toBeGreaterThanOrEqual(before);
    expect((body.exp as number) - (body.iat as number)).toBe(600);
  });

  it("throws on a key that isn't a PEM", () => {
    expect(() => ascToken({ ...CFG, privateKey: "not a key" }, NOW)).toThrow();
  });
});

describe("splitName", () => {
  it("splits first and the rest", () => {
    expect(splitName("Jane Q Doe")).toEqual({ firstName: "Jane", lastName: "Q Doe" });
    expect(splitName("  Jane   Doe ")).toEqual({ firstName: "Jane", lastName: "Doe" });
  });

  it("gives only a first name for one word", () => {
    expect(splitName("Jane")).toEqual({ firstName: "Jane" });
  });

  it("gives nothing for empty, blank, null or undefined", () => {
    expect(splitName("")).toEqual({});
    expect(splitName("   ")).toEqual({});
    expect(splitName(null)).toEqual({});
    expect(splitName(undefined)).toEqual({});
  });
});

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("inviteTester", () => {
  const person = { email: "jane+tf@example.com", name: "Jane Doe" };
  const API = "https://api.appstoreconnect.apple.com";

  type Call = [string, { method?: string; headers: Record<string, string>; body: string }];
  const callAt = (fetchImpl: ReturnType<typeof vi.fn>, i: number) => fetchImpl.mock.calls[i] as Call;

  function bearerOk(h: Record<string, string>) {
    expect(h.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(h["content-type"]).toBe("application/json");
  }

  it("creates the tester in the group on the first try", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(201, { data: {} }));
    expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: true, email: person.email, already: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = callAt(fetchImpl, 0);
    expect(url).toBe(`${API}/v1/betaTesters`);
    expect(init.method).toBe("POST");
    bearerOk(init.headers);
    expect(JSON.parse(init.body)).toEqual({
      data: {
        type: "betaTesters",
        attributes: { email: person.email, firstName: "Jane", lastName: "Doe" },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: "group-9" }] } },
      },
    });
  });

  it("sends only the email when there is no name", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(201));
    await inviteTester(CFG, { email: "a@b.co" }, fetchImpl, NOW);
    expect((JSON.parse(callAt(fetchImpl, 0)[1].body) as { data: { attributes: unknown } }).data.attributes).toEqual({ email: "a@b.co" });
  });

  it("works with the real clock and global fetch by default", async () => {
    const real = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(201));
    globalThis.fetch = fetchMock;
    try {
      // The default parameter binds `fetch` at call time, so the stub is the one used.
      expect(await inviteTester(CFG, person)).toMatchObject({ ok: true, already: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("returns Apple's error detail on a non-409 failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(403, { errors: [{ title: "Forbidden", detail: "This key can't manage testers." }] }));
    expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: false, error: "This key can't manage testers." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the error title, then to the status", async () => {
    const titled = vi.fn().mockResolvedValueOnce(reply(401, { errors: [{ title: "Unauthorized" }] }));
    expect(await inviteTester(CFG, person, titled, NOW)).toEqual({ ok: false, error: "Unauthorized" });
    const bare = vi.fn().mockResolvedValueOnce(reply(500));
    expect(await inviteTester(CFG, person, bare, NOW)).toEqual({ ok: false, error: "App Store Connect answered 500." });
    const emptyErrors = vi.fn().mockResolvedValueOnce(reply(502, { errors: [] }));
    expect(await inviteTester(CFG, person, emptyErrors, NOW)).toEqual({ ok: false, error: "App Store Connect answered 502." });
  });

  describe("409: already a tester in the account", () => {
    it("finds the tester by email and adds them to the group", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(reply(409, { errors: [{ detail: "exists" }] }))
        .mockResolvedValueOnce(reply(200, { data: [{ id: "tester-7" }] }))
        .mockResolvedValueOnce(reply(204));
      expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: true, email: person.email, already: true });
      expect(fetchImpl).toHaveBeenCalledTimes(3);

      const [lookupUrl, lookupInit] = callAt(fetchImpl, 1);
      expect(lookupUrl).toBe(`${API}/v1/betaTesters?filter[email]=${encodeURIComponent(person.email)}&limit=1`);
      expect(lookupUrl).toContain("jane%2Btf%40example.com");
      bearerOk(lookupInit.headers);
      expect(lookupInit.method).toBeUndefined();

      const [addUrl, addInit] = callAt(fetchImpl, 2);
      expect(addUrl).toBe(`${API}/v1/betaGroups/group-9/relationships/betaTesters`);
      expect(addInit.method).toBe("POST");
      bearerOk(addInit.headers);
      expect(JSON.parse(addInit.body)).toEqual({ data: [{ type: "betaTesters", id: "tester-7" }] });
    });

    it("fails with Apple's message when the lookup fails", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(reply(409))
        .mockResolvedValueOnce(reply(429, { errors: [{ detail: "Slow down." }] }));
      expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: false, error: "Slow down." });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("fails when the lookup finds nobody", async () => {
      for (const body of [{ data: [] }, {}]) {
        const fetchImpl = vi.fn().mockResolvedValueOnce(reply(409)).mockResolvedValueOnce(reply(200, body));
        expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({
          ok: false,
          error: "App Store Connect says this email is taken but can't find the tester.",
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      }
    });

    it("is still a success when the tester is already in the group (add answers 409)", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(reply(409))
        .mockResolvedValueOnce(reply(200, { data: [{ id: "tester-7" }] }))
        .mockResolvedValueOnce(reply(409));
      expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: true, email: person.email, already: true });
    });

    it("fails with Apple's message when adding to the group fails", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(reply(409))
        .mockResolvedValueOnce(reply(200, { data: [{ id: "tester-7" }] }))
        .mockResolvedValueOnce(reply(500, { errors: [{ detail: "Server trouble." }] }));
      expect(await inviteTester(CFG, person, fetchImpl, NOW)).toEqual({ ok: false, error: "Server trouble." });
    });
  });
});
