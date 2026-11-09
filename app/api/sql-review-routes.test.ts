import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Security → "Accept harmless SQL" (/api/sql-review): GET for any board read, PUT only from Weft's own window.

const token = vi.hoisted(() => ({ value: "" }));
vi.mock("@/lib/shell-token", () => ({ shellToken: () => token.value }));
vi.mock("next/server", () => ({ connection: async () => {} }));

const sqlAutoAccept = vi.fn(() => false);
const setSqlAutoAccept = vi.fn();
vi.mock("@/lib/db-calls", () => ({ sqlAutoAccept, setSqlAutoAccept }));

const route = await import("./sql-review/route");

const URL = "http://localhost:3457/api/sql-review";
const READ = { host: "localhost:3457", "x-weft-token": "1" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

const get = (headers: Record<string, string> = READ) => route.GET(new Request(URL, { headers }));
const put = (body: unknown, headers: Record<string, string> = WRITE) => route.PUT(new Request(URL, { method: "PUT", headers, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  sqlAutoAccept.mockReturnValue(false);
  token.value = "";
});

describe("GET /api/sql-review", () => {
  it("returns the switch", async () => {
    sqlAutoAccept.mockReturnValue(true);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoAccept: true });
  });

  it("refuses another host", async () => {
    const res = await get({ host: "evil.com", "x-weft-token": "1" });
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/sql-review", () => {
  it("saves a boolean", async () => {
    const res = await put({ autoAccept: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoAccept: true });
    expect(setSqlAutoAccept).toHaveBeenCalledWith(true);
  });

  it("refuses anything but a boolean", async () => {
    const res = await put({ autoAccept: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "autoAccept must be true or false." });
    expect(setSqlAutoAccept).not.toHaveBeenCalled();
  });

  it("refuses a write without Weft's own window", async () => {
    // Once a launch token exists, a thread's curl with the plain "1" passes the guard but not elevated().
    token.value = "launch-token";
    const res = await put({ autoAccept: true });
    expect(res.status).toBe(403);
    expect(setSqlAutoAccept).not.toHaveBeenCalled();
  });
});
