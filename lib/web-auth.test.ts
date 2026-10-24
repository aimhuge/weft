// lib/web-auth.ts: shared logic for the weft.zip visitor sign-in. Verifies the
// helpers (safeNextPath, isWebProvider, webAuthFailureUrl, webCallbackUrl,
// readWebSessionIdentity) the routes lean on. The OAuth round-trip helpers
// (startWebSignIn, finishWebSignIn, webSignOut) live in web-auth-flow.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebUser } from "./web-session";

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

beforeEach(() => {
  vi.clearAllMocks();
  isWebEnabled.mockReturnValue(true);
  webClient.mockResolvedValue({});
  webUser.mockResolvedValue(null);
  serviceClient.mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isWebProvider", () => {
  it("accepts the providers the route advertises", async () => {
    const { isWebProvider } = await load();
    expect(isWebProvider("github")).toBe(true);
    expect(isWebProvider("google")).toBe(true);
  });

  it("rejects anything else", async () => {
    const { isWebProvider } = await load();
    expect(isWebProvider("twitter")).toBe(false);
    expect(isWebProvider("")).toBe(false);
    expect(isWebProvider(null)).toBe(false);
    expect(isWebProvider({})).toBe(false);
  });
});

describe("webCallbackUrl", () => {
  it("builds the /auth/callback URL with the encoded `next`", async () => {
    const { webCallbackUrl } = await load();
    expect(webCallbackUrl("https://weft.zip", "/team", "/team")).toBe(
      "https://weft.zip/auth/callback?next=%2Fteam",
    );
  });

  it("sanitizes a same-origin `next` and falls back when off-origin", async () => {
    const { webCallbackUrl } = await load();
    expect(webCallbackUrl("https://weft.zip", "/app?x=1", "/team")).toBe(
      "https://weft.zip/auth/callback?next=%2Fapp%3Fx%3D1",
    );
    expect(webCallbackUrl("https://weft.zip", "//evil.com/x", "/team")).toBe(
      "https://weft.zip/auth/callback?next=%2Fteam",
    );
  });
});

describe("webCallbackOrigin", () => {
  it("leaves the request's own origin alone on the deployed site", async () => {
    const { webCallbackOrigin } = await load();
    expect(webCallbackOrigin("https://weft.zip", {})).toBe("https://weft.zip");
    // WEFT_HOME is a deployed signal too: the home page serves the site locally.
    expect(webCallbackOrigin("https://weft.zip", { WEFT_HOME: "1" })).toBe("https://weft.zip");
    expect(webCallbackOrigin("https://weft.zip", { VERCEL: "1" })).toBe("https://weft.zip");
  });

  it("pins the local callback to 127.0.0.1 so the allow-list needs one entry", async () => {
    const { webCallbackOrigin } = await load();
    expect(webCallbackOrigin("http://localhost:1024", { WEFT_WEB: "1" })).toBe("http://127.0.0.1:1024");
    expect(webCallbackOrigin("http://127.0.0.1:1024", { WEFT_WEB: "1" })).toBe("http://127.0.0.1:1024");
  });

  it("leaves a non-local request origin alone", async () => {
    // A preview deployment or a tunnel must redirect to the host the visitor came
    // from, not to the developer's loopback.
    const { webCallbackOrigin } = await load();
    expect(webCallbackOrigin("https://weft.zip", { WEFT_WEB: "1" })).toBe("https://weft.zip");
    expect(webCallbackOrigin("https://weft-git-abc.vercel.app", { WEFT_WEB: "1" })).toBe(
      "https://weft-git-abc.vercel.app",
    );
  });

  it("takes the port from WEFT_PORT and the whole origin from WEFT_WEB_ORIGIN", async () => {
    const { webCallbackOrigin } = await load();
    expect(webCallbackOrigin("http://localhost:3000", { WEFT_WEB: "1", WEFT_PORT: "3000" })).toBe(
      "http://127.0.0.1:3000",
    );
    expect(webCallbackOrigin("http://localhost:1024", { WEFT_WEB: "1", WEFT_WEB_ORIGIN: "http://127.0.0.1:9999" })).toBe(
      "http://127.0.0.1:9999",
    );
  });

  it("is a no-op without WEFT_WEB", async () => {
    const { webCallbackOrigin } = await load();
    expect(webCallbackOrigin("http://localhost:1024", {})).toBe("http://localhost:1024");
  });
});

describe("webAuthFailureUrl", () => {
  it("builds the /login?error=link&reason=… URL", async () => {
    const { webAuthFailureUrl } = await load();
    expect(webAuthFailureUrl("https://weft.zip", "provider")).toBe(
      "https://weft.zip/login?error=link&reason=provider",
    );
    expect(webAuthFailureUrl("https://weft.zip", "nocode")).toBe(
      "https://weft.zip/login?error=link&reason=nocode",
    );
    expect(webAuthFailureUrl("https://weft.zip", "exchange")).toBe(
      "https://weft.zip/login?error=link&reason=exchange",
    );
  });
});

describe("webSignInErrorUrl", () => {
  it("builds the /login?error=provider URL (omitting reason when it's the default 'provider')", async () => {
    const { webSignInErrorUrl } = await load();
    expect(webSignInErrorUrl("https://weft.zip", "provider")).toBe(
      "https://weft.zip/login?error=provider",
    );
  });

  it("includes the reason for auth-error and missing-url", async () => {
    const { webSignInErrorUrl } = await load();
    expect(webSignInErrorUrl("https://weft.zip", "auth-error")).toBe(
      "https://weft.zip/login?error=provider&reason=auth-error",
    );
    expect(webSignInErrorUrl("https://weft.zip", "missing-url")).toBe(
      "https://weft.zip/login?error=provider&reason=missing-url",
    );
  });
});

describe("readWebSessionIdentity", () => {
  it("returns null on `next dev` (not deployed)", async () => {
    isWebEnabled.mockReturnValue(false);
    const { readWebSessionIdentity } = await load();
    expect(await readWebSessionIdentity({})).toBeNull();
  });

  it("returns null when webUser is null (no session)", async () => {
    const { readWebSessionIdentity } = await load();
    webUser.mockResolvedValue(null);
    expect(await readWebSessionIdentity({})).toBeNull();
  });

  it("returns the identity from webUser when signed in", async () => {
    const { readWebSessionIdentity } = await load();
    const user: WebUser = { id: "u1", email: "ada@b.co", name: "Ada", avatar: "https://a" };
    webUser.mockResolvedValue(user);
    expect(await readWebSessionIdentity({})).toEqual({
      id: "u1",
      email: "ada@b.co",
      name: "Ada",
      avatar: "https://a",
    });
  });

  it("accepts a precomputed user (avoids a second getClaims call)", async () => {
    const { readWebSessionIdentity } = await load();
    const user: WebUser = { id: "u1", email: "ada@b.co", name: null, avatar: null };
    expect(await readWebSessionIdentity({}, undefined, user)).toEqual({
      id: "u1",
      email: "ada@b.co",
      name: null,
      avatar: null,
    });
    expect(webUser).not.toHaveBeenCalled();
  });
});
