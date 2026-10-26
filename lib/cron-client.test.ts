import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cronApi } from "./cron-client";
import type { Cron } from "./cron-types";
import type { Card } from "./types";

const cron = (over: Partial<Cron> = {}): Cron => ({
  id: "c1",
  name: "Daily digest",
  prompt: "do the thing",
  expr: "0 9 * * *",
  mode: "fresh",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 0,
  runs: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const card = { id: "card1", title: "Run 1", prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "backlog", createdAt: 1 } as unknown as Card;

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// A response like the browser's: ok, and a body that parses.
const answer = (body: unknown, init: { ok?: boolean; statusText?: string } = {}) => ({
  ok: init.ok ?? true,
  status: init.ok === false ? 500 : 200,
  statusText: init.statusText ?? "Server Error",
  json: () => Promise.resolve(body),
});

const lastCall = () => fetchMock.mock.calls[0] as [string, RequestInit];
const headersOf = (init: RequestInit) => new Headers(init.headers);

describe("cronApi.list", () => {
  it("asks for the crons and unwraps them", async () => {
    fetchMock.mockResolvedValue(answer({ crons: [cron()] }));
    await expect(cronApi.list()).resolves.toEqual([cron()]);
    const [url, init] = lastCall();
    expect(url).toBe("/api/crons");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

describe("cronApi.create", () => {
  it("posts the input as JSON and unwraps the cron", async () => {
    fetchMock.mockResolvedValue(answer({ cron: cron({ id: "new" }) }));
    const input = { prompt: "do it", expr: "0 9 * * *" };
    await expect(cronApi.create(input)).resolves.toEqual(cron({ id: "new" }));
    const [url, init] = lastCall();
    expect(url).toBe("/api/crons");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(input));
    expect(headersOf(init).get("content-type")).toBe("application/json");
  });
});

describe("cronApi.update", () => {
  it("patches the cron and unwraps it", async () => {
    fetchMock.mockResolvedValue(answer({ cron: cron({ name: "Renamed" }) }));
    await expect(cronApi.update("c1", { name: "Renamed" })).resolves.toEqual(cron({ name: "Renamed" }));
    const [url, init] = lastCall();
    expect(url).toBe("/api/crons/c1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "Renamed" }));
  });
});

describe("cronApi.remove", () => {
  it("deletes the cron and returns nothing", async () => {
    fetchMock.mockResolvedValue(answer({ ok: true }));
    await expect(cronApi.remove("c1")).resolves.toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toBe("/api/crons/c1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });
});

describe("cronApi.run", () => {
  it("runs the cron and unwraps the card it made", async () => {
    fetchMock.mockResolvedValue(answer({ card }));
    await expect(cronApi.run("c1")).resolves.toEqual(card);
    const [url, init] = lastCall();
    expect(url).toBe("/api/crons/c1/run");
    expect(init.method).toBe("POST");
  });
});

describe("the token header", () => {
  it("goes on every call", async () => {
    fetchMock.mockResolvedValue(answer({ crons: [] }));
    await cronApi.list();
    expect(headersOf(lastCall()[1]).get("x-weft-token")).toBe("1");
  });
});

describe("errors", () => {
  it("throws the route's error", async () => {
    fetchMock.mockResolvedValue(answer({ error: "No such cron" }, { ok: false }));
    await expect(cronApi.list()).rejects.toThrow("No such cron");
  });

  it("falls back to the status when the body isn't JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("not json")),
    });
    await expect(cronApi.list()).rejects.toThrow("Internal Server Error");
  });

  it("falls back to the status when the body has no error of its own", async () => {
    fetchMock.mockResolvedValue(answer({ crons: [] }, { ok: false, statusText: "Forbidden" }));
    await expect(cronApi.list()).rejects.toThrow("Forbidden");
  });
});
