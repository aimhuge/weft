import { afterEach, describe, expect, it, vi } from "vitest";
import { signature } from "./github-relay";
import { handlePush, restPing } from "./worker-push";

const SECRET = "whsec";
const MAIN = { ref: "refs/heads/main", repository: { full_name: "aimhuge/weft" } };

async function delivery(body: unknown, { event = "push", secret = SECRET }: { event?: string; secret?: string } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://weft.zip/api/github/push", { method: "POST", headers: { "x-hub-signature-256": await signature(secret, raw), "x-github-event": event }, body: raw });
}

afterEach(() => vi.unstubAllGlobals());

describe("handlePush", () => {
  it("pings on a signed push to main", async () => {
    const ping = vi.fn(() => Promise.resolve());
    expect((await handlePush(await delivery(MAIN), SECRET, ping)).status).toBe(200);
    expect(ping).toHaveBeenCalledOnce();
  });

  it("refuses a delivery signed with anything else, and one with no signature", async () => {
    const ping = vi.fn(() => Promise.resolve());
    expect((await handlePush(await delivery(MAIN, { secret: "other" }), SECRET, ping)).status).toBe(401);
    expect((await handlePush(new Request("https://weft.zip/x", { method: "POST", body: "{}" }), SECRET, ping)).status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it.each([
    ["another branch", { ...MAIN, ref: "refs/heads/dev" }, "push"],
    ["a tag", { ...MAIN, ref: "refs/tags/main" }, "push"],
    ["another repo", { ...MAIN, repository: { full_name: "fotoflo/weft" } }, "push"],
    ["main deleted", { ...MAIN, deleted: true }, "push"],
    ["GitHub's test delivery", { zen: "hi" }, "ping"],
    ["a body that isn't JSON", "nope", "push"],
  ])("answers %s and sends no ping", async (_name, body, event) => {
    const ping = vi.fn(() => Promise.resolve());
    expect((await handlePush(await delivery(body, { event }), SECRET, ping)).status).toBe(200);
    expect(ping).not.toHaveBeenCalled();
  });
});

describe("restPing", () => {
  it("calls the function with the secret key", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    await restPing("https://x.supabase.co", "k")();
    expect(fetchMock).toHaveBeenCalledWith("https://x.supabase.co/rest/v1/rpc/worker_update_ping", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ apikey: "k" }) as unknown }));
  });

  it("throws when it fails, so GitHub shows the delivery as failed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 500 }))));
    await expect(restPing("https://x.supabase.co", "k")()).rejects.toThrow("HTTP 500");
  });
});
