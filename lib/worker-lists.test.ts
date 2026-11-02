import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "./cron-types";
import type { Webhook } from "./webhook-types";
import { cronRow, createListsPublisher, hookRow, LIST_CAP } from "./worker-lists";

const cron = (id: string) => ({ id, cwd: "/home/w/work/weft", sessionId: "s", resumeAt: "r", name: id }) as unknown as Cron;
const hook = (id: string) => ({ id, folder: "/home/w/work/app", deliveries: [1, 2, 3, 4].map((at) => ({ at })) }) as unknown as Webhook;

afterEach(() => vi.useRealTimers());

describe("the published rows", () => {
  it("name the project, never the worker's path, and keep no fork session or old deliveries", () => {
    expect(cronRow(cron("c1"))).toMatchObject({ id: "c1", cwd: "weft", sessionId: undefined, resumeAt: undefined });
    const h = hookRow(hook("h1"));
    expect(h.folder).toBe("app");
    expect(h.deliveries).toHaveLength(3);
    expect(hookRow({ ...hook("h2"), deliveries: undefined }).deliveries).toBeUndefined();
  });
});

describe("createListsPublisher", () => {
  it("sends both lists once, a moment after however many pokes, capped", async () => {
    vi.useFakeTimers();
    const setLists = vi.fn(() => Promise.resolve(null));
    const many = Array.from({ length: LIST_CAP + 5 }, (_, i) => cron(`c${i}`));
    const p = createListsPublisher({ setLists }, { crons: () => many, webhooks: () => [hook("h1")] }, vi.fn(), 100);
    p.poke();
    p.poke();
    expect(setLists).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(setLists).toHaveBeenCalledTimes(1);
    const [crons, hooks] = setLists.mock.calls[0] as unknown as [Cron[], Webhook[]];
    expect(crons).toHaveLength(LIST_CAP);
    expect(hooks[0]?.folder).toBe("app");
  });

  it("flushes at once on asking, and logs a failure instead of throwing", async () => {
    const log = vi.fn();
    const p = createListsPublisher({ setLists: () => Promise.reject(new Error("down")) }, { crons: () => [], webhooks: () => [] }, log);
    p.poke();
    await p.flush();
    expect(log).toHaveBeenCalledWith("Weft Worker: couldn't publish its crons and webhooks: down");
    await p.flush();
    expect(log).toHaveBeenCalledTimes(2);
  });
});
