// dev.open and dev.stop: the card's own dev server, opened through a tunnel at its own path, or ended.
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDev = vi.hoisted(() => vi.fn());
const openTunnel = vi.hoisted(() => vi.fn(() => Promise.resolve({ address: "https://weft.zip/t/t1" })));
const stopDev = vi.hoisted(() => vi.fn());
const restartDev = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const runs = vi.hoisted(() => new Map<string, { log: string }>());
const getCard = vi.hoisted(() => vi.fn((id: string) => (id === "c1" ? { id, cwd: "/work/weft" } : undefined)));

vi.mock("../devserver-list", () => ({ listDev }));
vi.mock("../devserver", () => ({ stopDev, restartDev, runs }));
vi.mock("../tunnels", () => ({ openTunnel }));
vi.mock("../store", () => ({ getCard }));

const { devLogVerb, devOpenVerb, devRestartVerb, devStopVerb, DEV_LOG_LINES } = await import("./dev-servers");

beforeEach(() => {
  vi.clearAllMocks();
  runs.clear();
});

describe("dev.open", () => {
  it("opens the card's server through a tunnel, keeping its path", async () => {
    listDev.mockResolvedValue([{ cardId: "c2", url: "http://localhost:1" }, { cardId: "c1", url: "http://localhost:3000/app" }]);
    expect(await devOpenVerb({ id: "c1" })).toEqual({ address: "https://weft.zip/t/t1/app" });
    expect(openTunnel).toHaveBeenCalledWith({ folder: "/work/weft", target: "http://localhost:3000/app", cardId: "c1" });
    listDev.mockResolvedValue([{ cardId: "c1", url: "http://localhost:3000/" }]);
    expect(await devOpenVerb({ id: "c1" })).toEqual({ address: "https://weft.zip/t/t1" });
  });

  it("refuses a card with no server url, and one that isn't here", async () => {
    listDev.mockResolvedValue([{ cardId: "c1" }]);
    await expect(devOpenVerb({ id: "c1" })).rejects.toThrow("no dev server with a url");
    await expect(devOpenVerb({ id: "ghost" })).rejects.toThrow("No such card.");
  });
});

describe("dev.stop", () => {
  it("ends the card's run", async () => {
    expect(await devStopVerb({ id: "c1" })).toEqual({ ok: true });
    expect(stopDev).toHaveBeenCalledWith("c1");
    await expect(devStopVerb({ id: "ghost" })).rejects.toThrow("No such card.");
  });
});

describe("dev.restart", () => {
  it("starts the card's run again", async () => {
    runs.set("c1", { log: "" });
    expect(await devRestartVerb({ id: "c1" })).toEqual({ ok: true });
    expect(restartDev).toHaveBeenCalledWith("c1");
  });

  it("refuses a server Weft didn't start, and a card that isn't here", async () => {
    await expect(devRestartVerb({ id: "c1" })).rejects.toThrow("can only stop it");
    await expect(devRestartVerb({ id: "ghost" })).rejects.toThrow("No such card.");
    expect(restartDev).not.toHaveBeenCalled();
  });
});

describe("dev.log", () => {
  it("answers the run's newest lines with keys hidden", async () => {
    const lines = Array.from({ length: DEV_LOG_LINES + 5 }, (_, i) => `line ${i}`);
    runs.set("c1", { log: `${lines.join("\n")}\nkey sk-ant-api03-${"a".repeat(90)}\n` });
    const { log } = await devLogVerb({ id: "c1" });
    expect(log.split("\n")).toHaveLength(DEV_LOG_LINES);
    expect(log).not.toContain("line 5\n");
    expect(log).not.toContain("a".repeat(90));
    await expect(devLogVerb({ id: "c2" })).rejects.toThrow("No such card.");
  });
});
