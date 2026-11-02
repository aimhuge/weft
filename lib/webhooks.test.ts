import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry against a real file in a temp dir (WEFT_DATA), never the real ~/.weft.
let dir: string;

async function load() {
  vi.resetModules();
  return import("./webhooks");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-webhooks-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("addWebhook", () => {
  it("adds a blank, turning a bare path into a localhost URL", async () => {
    const w = await load();
    const { hook, existed } = w.addWebhook({ folder: "/a", name: "  stripe ", target: "/api/stripe/webhook", events: ["a", "b", "a", " "], hint: " Stripe  dashboard ", secret: "STRIPE_WEBHOOK_SECRET" }, 5);
    expect(existed).toBe(false);
    expect(hook).toMatchObject({ folder: "/a", name: "stripe", target: "http://localhost:3000/api/stripe/webhook", events: ["a", "b"], hint: "Stripe dashboard", secret: "STRIPE_WEBHOOK_SECRET", createdAt: 5, updatedAt: 5 });
    expect(hook.registered).toBeUndefined();
    expect(w.getWebhook(hook.id)).toEqual(hook);
    expect((JSON.parse(fs.readFileSync(path.join(dir, "webhooks.json"), "utf8")) as { hooks: unknown[] }).hooks).toHaveLength(1);
  });

  it("merges into the webhook of the same name in the folder, keeping what isn't given", async () => {
    const w = await load();
    const first = w.addWebhook({ folder: "/a", name: "Stripe", target: "/one", hint: "here" }, 1).hook;
    const again = w.addWebhook({ folder: "/a", name: "stripe", target: "http://127.0.0.1:4000/two", events: "x, y" as unknown as string[] }, 2);
    expect(again.existed).toBe(true);
    expect(again.hook).toMatchObject({ id: first.id, name: "Stripe", target: "http://127.0.0.1:4000/two", hint: "here", events: ["x", "y"], createdAt: 1, updatedAt: 2 });
    expect(w.listWebhooks()).toHaveLength(1);
    // Another folder gets its own; an empty events list or hint clears the field.
    w.addWebhook({ folder: "/b", name: "stripe", target: "/one" });
    expect(w.listWebhooks()).toHaveLength(2);
    expect(w.addWebhook({ folder: "/a", name: "stripe", events: [], hint: 5 as unknown as string, secret: "" }).hook).toMatchObject({ events: undefined, hint: undefined, secret: undefined });
    expect(w.addWebhook({ folder: "/a", name: "stripe", events: null as unknown as string[], secret: null as unknown as string }).hook.id).toBe(first.id);
  });

  it("refuses a missing folder, name or target, and a non-local or malformed target", async () => {
    const w = await load();
    expect(() => w.addWebhook({ folder: "", name: "x", target: "/x" })).toThrow("project folder");
    expect(() => w.addWebhook({ folder: 3 as unknown as string, name: "x", target: "/x" })).toThrow("project folder");
    expect(() => w.addWebhook({ folder: "/a", name: "  ", target: "/x" })).toThrow("needs a name");
    expect(() => w.addWebhook({ folder: "/a", name: 4 as unknown as string, target: "/x" })).toThrow("needs a name");
    expect(() => w.addWebhook({ folder: "/a", name: "x" })).toThrow("local route");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: " " })).toThrow("local route");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: 3 as unknown as string })).toThrow("local route");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "nope" })).toThrow("isn't a URL or a path");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "ftp://localhost/x" })).toThrow("http URL");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "https://example.com/hook" })).toThrow("localhost");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "/x", secret: "not a name" })).toThrow("vault name");
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "/x", secret: 5 as unknown as string })).toThrow("vault name");
    expect(w.listWebhooks()).toEqual([]);
    expect(w.cleanTarget("http://[::1]:3000/x")).toBe("http://[::1]:3000/x");
    expect(w.cleanTarget("https://localhost/x")).toBe("https://localhost/x");
  });
});

describe("listWebhooks", () => {
  it("is empty with no file, and lists by folder then name, optionally for some folders", async () => {
    const w = await load();
    expect(w.listWebhooks()).toEqual([]);
    w.addWebhook({ folder: "/b", name: "z", target: "/z" });
    w.addWebhook({ folder: "/a", name: "y", target: "/y" });
    w.addWebhook({ folder: "/a", name: "x", target: "/x" });
    expect(w.listWebhooks().map((h) => `${h.folder}:${h.name}`)).toEqual(["/a:x", "/a:y", "/b:z"]);
    expect(w.listWebhooks(["/b"]).map((h) => h.name)).toEqual(["z"]);
    fs.writeFileSync(path.join(dir, "webhooks.json"), "{}");
    expect(w.listWebhooks()).toEqual([]);
    fs.writeFileSync(path.join(dir, "webhooks.json"), "not json");
    expect(w.listWebhooks()).toEqual([]);
  });
});

describe("updateWebhook", () => {
  it("changes fields, including registered, and reports a missing id or a name clash", async () => {
    const w = await load();
    const a = w.addWebhook({ folder: "/a", name: "stripe", target: "/s", hint: "h" }).hook;
    w.addWebhook({ folder: "/a", name: "github", target: "/g" });
    const next = w.updateWebhook(a.id, { name: "Stripe 2", target: "/s2", events: ["e"], hint: "", secret: "K", registered: true }, 9);
    expect(next).toMatchObject({ name: "Stripe 2", target: "http://localhost:3000/s2", events: ["e"], hint: undefined, secret: "K", registered: true, updatedAt: 9 });
    expect(w.updateWebhook(a.id, {}).name).toBe("Stripe 2");
    expect(w.updateWebhook(a.id, { name: "Stripe 2" }).id).toBe(a.id);
    expect(() => w.updateWebhook(a.id, { name: "GitHub" })).toThrow("already a webhook");
    expect(w.getWebhook(a.id)?.name).toBe("Stripe 2");
    expect(() => w.updateWebhook("nope", {})).toThrow("gone");
  });
});

describe("removeWebhook", () => {
  it("removes one and returns it, or nothing for an unknown id", async () => {
    const w = await load();
    const a = w.addWebhook({ folder: "/a", name: "x", target: "/x" }).hook;
    expect(w.removeWebhook("nope")).toBeUndefined();
    expect(w.removeWebhook(a.id)).toEqual(a);
    expect(w.listWebhooks()).toEqual([]);
  });
});

describe("setRelay", () => {
  it("adds a relay url, finds the webhook by it, and clears it", async () => {
    const w = await load();
    const a = w.addWebhook({ folder: "/a", name: "x", target: "/x" }).hook;
    expect(w.setRelay(a.id, { relayId: "r1", url: "https://weft.zip/hook/r1" }, 3)).toMatchObject({ relayId: "r1", url: "https://weft.zip/hook/r1", updatedAt: 3 });
    expect(w.webhookByRelay("r1")?.id).toBe(a.id);
    expect(w.webhookByRelay("r2")).toBeUndefined();
    const cleared = w.setRelay(a.id);
    expect("relayId" in cleared || "url" in cleared).toBe(false);
    expect(w.webhookByRelay("r1")).toBeUndefined();
    expect(() => w.setRelay("nope")).toThrow("gone");
  });
});

describe("recordDelivery", () => {
  it("keeps the newest deliveries up to the cap and marks the webhook registered", async () => {
    const w = await load();
    const a = w.addWebhook({ folder: "/a", name: "x", target: "/x" }).hook;
    expect(a.registered).toBeUndefined();
    for (let i = 0; i < w.MAX_DELIVERIES + 3; i++) w.recordDelivery(a.id, { at: i, method: "POST", status: 200, ms: 1 });
    const got = w.getWebhook(a.id)!;
    expect(got.registered).toBe(true);
    expect(got.deliveries).toHaveLength(w.MAX_DELIVERIES);
    expect(got.deliveries?.[0]?.at).toBe(w.MAX_DELIVERIES + 2);
    expect(w.recordDelivery("nope", { at: 1, method: "POST", status: 0, ms: 1, error: "down" })).toBeUndefined();
  });
});

describe("provider", () => {
  it("rejects a provider the relay can't verify, and lowercases + trims what it keeps", async () => {
    const w = await load();
    // addWebhook runs cleanProvider, so an unknown one throws.
    expect(() => w.addWebhook({ folder: "/a", name: "x", target: "/x", provider: "acme" })).toThrow(/one of: stripe/);
    const a = w.addWebhook({ folder: "/a", name: "x", target: "/x", provider: " Github " }, 1).hook;
    expect(a.provider).toBe("github");
    // updateWebhook too.
    expect(w.updateWebhook(a.id, { provider: "Stripe" }).provider).toBe("stripe");
    // An empty patch clears it; non-string throws.
    expect(w.updateWebhook(a.id, { provider: "" }).provider).toBeUndefined();
    expect(() => w.updateWebhook(a.id, { provider: 3 as unknown as string })).toThrow();
    expect(() => w.updateWebhook(a.id, { provider: "stripe" })).not.toThrow();
  });

  it("providerFor resolves a recorded value first, then a lowercased name when that matches", async () => {
    const w = await load();
    const stripe = w.addWebhook({ folder: "/a", name: "Stripe", target: "/x" }).hook;
    expect(w.providerFor(stripe)).toBe("stripe");
    const resend = w.addWebhook({ folder: "/a", name: "resend", target: "/x", provider: "svix" }).hook;
    expect(w.providerFor(resend)).toBe("svix");
    const team = w.addWebhook({ folder: "/a", name: "team-chat", target: "/x" }).hook;
    expect(w.providerFor(team)).toBeNull();
  });
});

describe("onWebhooksWrite", () => {
  it("tells its listener after every write, until it stops listening", async () => {
    const w = await load();
    const heard = vi.fn();
    const stop = w.onWebhooksWrite(heard);
    w.addWebhook({ folder: "/a", name: "stripe", target: "/x" }, 1);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    w.addWebhook({ folder: "/a", name: "github", target: "/y" }, 2);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
