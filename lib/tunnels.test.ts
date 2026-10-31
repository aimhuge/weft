import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tunnels-"));

const m = vi.hoisted(() => ({
  session: { user: { id: "me" } },
  approved: true,
  updates: [] as { table: string; fields: Record<string, unknown>; id: string }[],
  inserts: [] as Record<string, unknown>[],
  exits: [] as (() => void)[],
  stops: 0,
  quickFails: 0,
  hooks: [] as { name: string; relayId?: string; target: string }[],
}));

vi.mock("./store", () => ({ DATA_DIR: dir }));
vi.mock("./site", () => ({ SITE: "https://weft.zip" }));
vi.mock("./webhooks", () => ({ listWebhooks: () => m.hooks }));
vi.mock("./browser-tools", () => ({ shell: () => Promise.resolve({ approved: m.approved }) }));
vi.mock("./tunnel-cloudflared", () => ({
  ensureCloudflared: () => Promise.resolve("/bin/cloudflared"),
  startQuickTunnel: (_bin: string, _port: number, onExit: () => void) => {
    if (m.quickFails > 0) {
      m.quickFails--;
      return Promise.reject(new Error("no url"));
    }
    m.exits.push(onExit);
    return Promise.resolve({ url: `https://u${m.exits.length}.trycloudflare.com`, stop: () => m.stops++ });
  },
}));
vi.mock("./account", () => ({
  accountClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: m.session } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      insert: (row: Record<string, unknown>) => {
        m.inserts.push(row);
        return Promise.resolve({ error: null });
      },
      update: (fields: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          m.updates.push({ table, fields, id });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { closeTunnel, listTunnels, MAX_HOURS, openTunnel, tunnelAddress } = await import("./tunnels");
const TARGET = "http://localhost:4000/";
const open = (hours?: number) => openTunnel({ folder: "/p", target: TARGET, hours });
const published = () => m.updates.filter((u) => u.table === "tunnels").map((u) => u.fields);

beforeEach(() => {
  Object.assign(m, { session: { user: { id: "me" } }, approved: true, updates: [], inserts: [], exits: [], stops: 0, quickFails: 0, hooks: [] });
  fs.rmSync(path.join(dir, "tunnels.json"), { force: true });
});
afterEach(async () => {
  for (const t of listTunnels()) await closeTunnel(t.id);
});

describe("opening a tunnel", () => {
  it("publishes the URL and a secret behind a stable address", async () => {
    const t = await open();
    expect(t.address).toBe(tunnelAddress(t.id));
    expect(m.inserts).toEqual([{ id: t.id, name: "localhost:4000" }]);
    expect(published()[0]).toMatchObject({ public_url: "https://u1.trycloudflare.com" });
    expect(String(published()[0]?.ticket_secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(listTunnels(["/p"])).toHaveLength(1);
    expect(listTunnels(["/other"])).toHaveLength(0);
  });

  it("needs a sign-in and your approval, and opens nothing without them", async () => {
    Object.assign(m, { session: null });
    await expect(open()).rejects.toThrow(/Sign in/);
    Object.assign(m, { session: { user: { id: "me" } } });
    m.approved = false;
    await expect(open()).rejects.toThrow(/Touch ID/);
    expect(listTunnels()).toEqual([]);
    expect(m.inserts).toEqual([]);
  });

  it("refuses Weft's own port", async () => {
    vi.stubEnv("PORT", "4000");
    await expect(open()).rejects.toThrow(/Weft's own port/);
    vi.unstubAllEnvs();
  });

  it("returns the one already open, and keeps its address the next time", async () => {
    const first = await open();
    expect((await open()).id).toBe(first.id);
    await closeTunnel(first.id);
    expect((await open()).id).toBe(first.id);
  });

  it("caps how long one stays open", async () => {
    const at = Date.now();
    const t = await openTunnel({ folder: "/p", target: TARGET, hours: 1000 }, at);
    expect(t.expiresAt).toBe(at + MAX_HOURS * 60 * 60 * 1000);
  });

  it("cleans up when cloudflared never starts", async () => {
    m.quickFails = 1;
    await expect(open()).rejects.toThrow("no url");
    expect(listTunnels()).toEqual([]);
    expect(published().at(-1)).toEqual(expect.objectContaining({ public_url: null, ticket_secret: null }));
  });
});

describe("relays", () => {
  it("points this server's relays at the tunnel, and back when it closes", async () => {
    m.hooks = [
      { name: "stripe", relayId: "r1", target: "http://localhost:4000/api/stripe" },
      { name: "other", relayId: "r2", target: "http://localhost:5000/api/x" },
      { name: "blank", target: "http://localhost:4000/api/y" },
    ];
    const t = await open();
    const relays = () => m.updates.filter((u) => u.table === "webhook_relays");
    expect(relays()).toEqual([{ table: "webhook_relays", id: "r1", fields: { tunnel_id: t.id, tunnel_path: "/api/stripe" } }]);
    await closeTunnel(t.id);
    expect(relays()[1]).toEqual({ table: "webhook_relays", id: "r1", fields: { tunnel_id: null, tunnel_path: null } });
  });
});

describe("while it's open", () => {
  it("publishes a new URL when cloudflared restarts", async () => {
    await open();
    m.exits[0]!();
    await vi.waitFor(() => expect(published().at(-1)).toMatchObject({ public_url: "https://u2.trycloudflare.com" }));
  });

  it("closes after repeated failures rather than retrying for ever", async () => {
    await open();
    m.quickFails = 10;
    m.exits[0]!();
    await vi.waitFor(() => expect(listTunnels()).toEqual([]));
  });

  it("forgets the URL and secret on close, and ignores a tunnel that's gone", async () => {
    const t = await open();
    await closeTunnel(t.id);
    expect(m.stops).toBe(1);
    expect(published().at(-1)).toMatchObject({ public_url: null, ticket_secret: null, expires_at: null });
    await expect(closeTunnel("gone")).resolves.toBeUndefined();
  });
});
