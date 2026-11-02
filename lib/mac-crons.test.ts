import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "./cron-types";
import type { BoardEvent } from "./types";

vi.mock("./account", () => ({ accountClient: () => fakeClient() }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-1" }));
const listeners = vi.hoisted(() => new Set<(e: BoardEvent) => void>());
vi.mock("./bus", () => ({
  subscribe: (fn: (e: BoardEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));
const stored = vi.hoisted(() => ({ crons: [] as Cron[] }));
vi.mock("./cron-store", () => ({ listCrons: () => stored.crons }));

const { createMacCronsPublisher, MAC_PROMPT_MAX, macCronRow, macCronRows, putMacCrons, startMacCronsPublish } = await import("./mac-crons");

const upserts: unknown[] = [];
function fakeClient({ session = true, error = null as { message: string } | null } = {}) {
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: session ? { user: { id: "u1" } } : null } }) },
    from: (table: string) => ({
      upsert: (row: unknown, opts: unknown) => {
        upserts.push({ table, row, opts });
        return Promise.resolve({ error });
      },
    }),
  } as never;
}

const cron = (over: Partial<Cron> = {}) => ({ id: "k1", name: "Daily", prompt: "check it", expr: "0 9 * * *", mode: "fresh", cwd: "/Users/me/dev/app", enabled: true, sessionId: "s", runs: [], ...over }) as Cron;

beforeEach(() => {
  upserts.length = 0;
  listeners.clear();
  stored.crons = [];
});
afterEach(() => vi.useRealTimers());

describe("macCronRow", () => {
  it("keeps what a list shows: the project's name, never its path or the fork's session", () => {
    expect(macCronRow(cron({ nextAt: 5 }))).toEqual({ id: "k1", name: "Daily", expr: "0 9 * * *", mode: "fresh", enabled: true, folder: "app", nextAt: 5, prompt: "check it" });
  });

  it("leaves a long prompt out, and a worker's crons", () => {
    expect(macCronRow(cron({ prompt: "x".repeat(MAC_PROMPT_MAX + 1) })).prompt).toBeUndefined();
    expect(macCronRows([cron(), cron({ id: "w", worker: "mini" })]).map((r) => r.id)).toEqual(["k1"]);
  });
});

describe("putMacCrons", () => {
  it("upserts this Mac's row as the signed-in user", async () => {
    expect(await putMacCrons([], fakeClient(), "dev-1", "x".repeat(150))).toBe(true);
    expect(upserts).toMatchObject([{ table: "cloud_mac_crons", row: { owner_user: "u1", device: "dev-1", label: "x".repeat(100), crons: [] }, opts: { onConflict: "owner_user,device" } }]);
    expect(typeof (upserts[0] as { row: { updated_at: unknown } }).row.updated_at).toBe("string");
  });

  it("writes nothing signed out, and throws the database's error", async () => {
    expect(await putMacCrons([], fakeClient({ session: false }))).toBe(false);
    await expect(putMacCrons([], fakeClient({ error: { message: "no table" } }))).rejects.toThrow("no table");
  });

  it("uses the account client, this Mac's id and its name by default", async () => {
    expect(await putMacCrons([])).toBe(true);
    expect(upserts[0]).toMatchObject({ row: { device: "dev-1" } });
  });
});

describe("createMacCronsPublisher", () => {
  it("sends once a moment after any number of pokes", async () => {
    vi.useFakeTimers();
    const put = vi.fn(() => Promise.resolve());
    const p = createMacCronsPublisher({ read: () => [cron()], put, delayMs: 100 });
    p.poke();
    p.poke();
    await vi.advanceTimersByTimeAsync(100);
    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith([expect.objectContaining({ id: "k1" })]);
  });

  it("logs a failure once until a publish works again", async () => {
    const log = vi.fn();
    const put = vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error("no table")));
    const p = createMacCronsPublisher({ read: () => [], put, log });
    await p.flush();
    await p.flush();
    expect(log).toHaveBeenCalledOnce();
    put.mockResolvedValueOnce(true);
    await p.flush();
    await p.flush();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("logs to the console by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createMacCronsPublisher({ read: () => [], put: () => Promise.reject(new Error("x")) }).flush();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/couldn't publish this Mac's crons/));
    warn.mockRestore();
  });
});

describe("startMacCronsPublish", () => {
  it("publishes at once, after a crons event and every so often, until stopped", async () => {
    vi.useFakeTimers();
    const put = vi.fn(() => Promise.resolve());
    const stop = startMacCronsPublish({ put, delayMs: 10 }, 1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledTimes(1);
    for (const l of listeners) l({ type: "card_deleted" } as never);
    for (const l of listeners) l({ type: "crons" });
    await vi.advanceTimersByTimeAsync(10);
    expect(put).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(put).toHaveBeenCalledTimes(3);
    stop();
    expect(listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("reads this Mac's crons and writes them with the account by default", async () => {
    stored.crons = [cron()];
    const stop = startMacCronsPublish();
    await vi.waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0]).toMatchObject({ row: { crons: [{ id: "k1" }] } });
    stop();
  });
});
