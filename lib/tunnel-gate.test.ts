import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { cleanGateTarget, ENTER_PATH, publicLocation, safeNext, startGate } from "./tunnel-gate";
import { enterTicket, FORWARD_HEADER, forwardTicket, TICKET_TTL_MS, verifyEnter, verifyForward } from "./tunnel-ticket";

const ID = "tunnel-1";
const SECRET = "a-secret";

let seen: http.IncomingHttpHeaders[];
let dev: http.Server;
let gate: Awaited<ReturnType<typeof startGate>>;
let base: string;

beforeEach(async () => {
  seen = [];
  dev = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/moved") {
      res.writeHead(302, { location: `http://127.0.0.1:${(dev.address() as AddressInfo).port}/there` });
      return res.end();
    }
    res.end(`dev ${req.method} ${req.url}`);
  });
  new WebSocketServer({ server: dev }).on("connection", (ws, req) => {
    seen.push(req.headers);
    ws.on("message", (m) => ws.send(`echo:${(m as Buffer).toString()}`));
  });
  await new Promise<void>((resolve) => dev.listen(0, "127.0.0.1", resolve));
  gate = await startGate({ tunnelId: ID, secret: SECRET, target: `http://127.0.0.1:${(dev.address() as AddressInfo).port}` });
  base = `http://127.0.0.1:${gate.port}`;
});

afterEach(async () => {
  await gate.close();
  dev.closeAllConnections();
  await new Promise((resolve) => dev.close(resolve));
});

async function enter(next = "/") {
  const res = await fetch(`${base}${ENTER_PATH}?ticket=${enterTicket(SECRET, ID)}&next=${encodeURIComponent(next)}`, { redirect: "manual" });
  return { res, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
}

describe("the gate", () => {
  it("refuses a request with no ticket or session, so the dev server never sees it", async () => {
    const res = await fetch(`${base}/secret`);
    expect(res.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("refuses a made-up session cookie", async () => {
    expect((await fetch(`${base}/`, { headers: { cookie: "weft_gate=nope" } })).status).toBe(401);
  });

  it("turns a good ticket into a private session cookie", async () => {
    const { res, cookie } = await enter("/page");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/page");
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(await (await fetch(`${base}/page`, { headers: { cookie } })).text()).toBe("dev GET /page");
  });

  it("refuses a ticket signed for another tunnel, with another secret, or used twice", async () => {
    const tryTicket = async (t: string) => (await fetch(`${base}${ENTER_PATH}?ticket=${t}`, { redirect: "manual" })).status;
    expect(await tryTicket(enterTicket(SECRET, "other"))).toBe(403);
    expect(await tryTicket(enterTicket("wrong", ID))).toBe(403);
    const once = enterTicket(SECRET, ID);
    expect(await tryTicket(once)).toBe(302);
    expect(await tryTicket(once)).toBe(403);
  });

  it("hands the dev server localhost's Host and Origin, and none of the gate's traces", async () => {
    const { cookie } = await enter();
    await fetch(`${base}/x`, { headers: { cookie: `${cookie}; theirs=1`, origin: "https://abc.trycloudflare.com", "x-weft-token": "stolen" } });
    const got = seen[0]!;
    expect(got.host).toBe(`127.0.0.1:${(dev.address() as AddressInfo).port}`);
    expect(got.origin).toBe(`http://127.0.0.1:${(dev.address() as AddressInfo).port}`);
    expect(got["x-weft-token"]).toBeUndefined();
    expect(got.cookie).toBe("theirs=1");
  });

  it("keeps a redirect on the tunnel rather than the visitor's own localhost", async () => {
    const { cookie } = await enter();
    const res = await fetch(`${base}/moved`, { headers: { cookie }, redirect: "manual" });
    expect(res.headers.get("location")).toBe("/there");
  });

  it("lets one delivery through on a forward ticket for that method and path only", async () => {
    const ticket = forwardTicket(SECRET, ID, "POST", "/hook");
    expect((await fetch(`${base}/other`, { method: "POST", headers: { [FORWARD_HEADER]: ticket } })).status).toBe(401);
    expect((await fetch(`${base}/hook`, { method: "PUT", headers: { [FORWARD_HEADER]: ticket } })).status).toBe(401);
    const res = await fetch(`${base}/hook`, { method: "POST", body: "x", headers: { [FORWARD_HEADER]: ticket } });
    expect(await res.text()).toBe("dev POST /hook");
    expect(seen[0]![FORWARD_HEADER]).toBeUndefined();
    expect((await fetch(`${base}/hook`, { method: "POST", headers: { [FORWARD_HEADER]: ticket } })).status).toBe(401);
  });

  it("refuses a WebSocket with no session, and carries one that has it", async () => {
    const ws = (headers: Record<string, string>) => new WebSocket(`ws://127.0.0.1:${gate.port}/_hmr`, { headers });
    const refused = await new Promise((resolve) => ws({}).on("error", resolve).on("open", () => resolve("open")));
    expect(String(refused)).toContain("401");
    const { cookie } = await enter();
    const open = ws({ cookie });
    const reply = await new Promise((resolve) => {
      open.on("open", () => open.send("hi"));
      open.on("message", (m) => resolve((m as Buffer).toString()));
    });
    expect(reply).toBe("echo:hi");
    open.close();
  });

  it("says so when the dev server is down", async () => {
    const { cookie } = await enter();
    dev.closeAllConnections();
    await new Promise((resolve) => dev.close(resolve));
    expect((await fetch(`${base}/`, { headers: { cookie } })).status).toBe(502);
    dev = http.createServer();
    await new Promise<void>((resolve) => dev.listen(0, resolve));
  });

  it("ends a session after its time", async () => {
    let at = 1_000;
    await gate.close();
    gate = await startGate({ tunnelId: ID, secret: SECRET, target: "http://127.0.0.1:9", now: () => at });
    base = `http://127.0.0.1:${gate.port}`;
    const res = await fetch(`${base}${ENTER_PATH}?ticket=${enterTicket(SECRET, ID, at)}`, { redirect: "manual" });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    at += 13 * 60 * 60 * 1000;
    expect((await fetch(`${base}/`, { headers: { cookie } })).status).toBe(401);
  });
});

describe("the rules around it", () => {
  it("only opens http on this Mac, and never Weft's own port", () => {
    expect(cleanGateTarget("http://localhost:3000").port).toBe("3000");
    expect(() => cleanGateTarget("http://example.com:3000")).toThrow(/on this Mac/);
    expect(() => cleanGateTarget("https://localhost:3000")).toThrow(/http URL/);
    expect(() => cleanGateTarget("http://127.0.0.1:3000", 3000)).toThrow(/Weft's own port/);
  });

  it("keeps next on this site", () => {
    expect(safeNext("/a?b=1")).toBe("/a?b=1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", null]) expect(safeNext(bad)).toBe("/");
  });

  it("leaves another site's redirect alone", () => {
    expect(publicLocation("https://accounts.google.com/x", new URL("http://localhost:3000"))).toBe("https://accounts.google.com/x");
    expect(publicLocation("http://localhost:3000", new URL("http://localhost:3000"))).toBe("/");
  });

  it("expires tickets, and won't take an expiry signing couldn't give", () => {
    const t = enterTicket(SECRET, ID, 1_000);
    expect(verifyEnter(t, SECRET, ID, 1_000)).toBe(true);
    expect(verifyEnter(t, SECRET, ID, 1_000 + TICKET_TTL_MS)).toBe(false);
    expect(verifyEnter(t, SECRET, ID, 1_000 - 1)).toBe(false);
    expect(verifyEnter("garbage", SECRET, ID)).toBe(false);
  });

  it("keeps an enter ticket from standing in for a delivery", () => {
    expect(verifyForward(enterTicket(SECRET, ID, 1_000), SECRET, ID, "POST", "/h", 1_000)).toBe(false);
  });
});
