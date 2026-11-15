import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /auth/sign-out: this device only, or every device with the form field scope=global.
const webSignOut = vi.fn(() => Promise.resolve({ kind: "redirect" as const, url: "https://weft.zip/login" }));
const isWebEnabled = vi.fn(() => true);
vi.mock("@/lib/home", () => ({ isWebEnabled }));
vi.mock("@/lib/web-auth", () => ({
  webClient: () => Promise.resolve({}),
  webRequestOrigin: () => "https://weft.zip",
  webCallbackOrigin: (origin: string) => origin,
  webSignOut,
}));

const { POST } = await import("./route");

function post(form?: Record<string, string>) {
  const body = form ? new URLSearchParams(form) : undefined;
  return POST(new Request("https://weft.zip/auth/sign-out", { method: "POST", body }));
}

beforeEach(() => vi.clearAllMocks());

describe("POST /auth/sign-out", () => {
  it("signs out here by default and 303s to /login", async () => {
    const res = await post();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://weft.zip/login");
    expect(webSignOut).toHaveBeenCalledWith({}, expect.objectContaining({ scope: "local", loginPath: "/login" }));
  });

  it("signs out everywhere for scope=global, and only for that value", async () => {
    await post({ scope: "global" });
    expect(webSignOut).toHaveBeenLastCalledWith({}, expect.objectContaining({ scope: "global" }));
    await post({ scope: "everyone" });
    expect(webSignOut).toHaveBeenLastCalledWith({}, expect.objectContaining({ scope: "local" }));
  });

  it("is a 404 where the web side is off", async () => {
    isWebEnabled.mockReturnValueOnce(false);
    expect((await post()).status).toBe(404);
    expect(webSignOut).not.toHaveBeenCalled();
  });
});
