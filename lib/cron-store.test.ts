import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "./cron-types";

// The crons file against a real DATA_DIR (WEFT_DATA), never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  const store = await import("./store");
  const crons = await import("./cron-store");
  return { store, crons };
}

const cronsFile = () => path.join(dir, "crons.json");
const onDisk = () => (JSON.parse(fs.readFileSync(cronsFile(), "utf8")) as { crons: Cron[] }).crons;

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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cron-store-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listCrons", () => {
  it("is empty when there is no file yet", async () => {
    const t = await load();
    expect(t.crons.listCrons()).toEqual([]);
    expect(fs.existsSync(cronsFile())).toBe(false);
  });

  it("reads a broken file, or one with no crons key, as empty", async () => {
    const t = await load();
    fs.writeFileSync(cronsFile(), "{not json");
    expect(t.crons.listCrons()).toEqual([]);
    fs.writeFileSync(cronsFile(), "{}");
    expect(t.crons.listCrons()).toEqual([]);
  });

  it("reads the crons it was given", async () => {
    const t = await load();
    t.crons.saveCron(cron());
    t.crons.saveCron(cron({ id: "c2", name: "Other" }));
    expect(t.crons.listCrons().map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("getCron", () => {
  it("finds the cron with that id, and nothing for an unknown one", async () => {
    const t = await load();
    t.crons.saveCron(cron());
    expect(t.crons.getCron("c1")?.name).toBe("Daily digest");
    expect(t.crons.getCron("nope")).toBeUndefined();
  });
});

describe("saveCron", () => {
  it("adds a cron, and writes the file with a crons key", async () => {
    const t = await load();
    const saved = t.crons.saveCron(cron());
    expect(saved.id).toBe("c1");
    expect(onDisk()).toEqual([cron()]);
  });

  it("replaces the cron with the same id rather than adding another", async () => {
    const t = await load();
    t.crons.saveCron(cron());
    t.crons.saveCron(cron({ name: "Renamed" }));
    const all = t.crons.listCrons();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Renamed");
  });

  it("makes the data dir when it isn't there yet", async () => {
    const t = await load();
    fs.rmSync(dir, { recursive: true, force: true });
    t.crons.saveCron(cron());
    expect(onDisk()).toHaveLength(1);
  });
});

describe("removeCron", () => {
  it("takes the cron off the file and says it did", async () => {
    const t = await load();
    t.crons.saveCron(cron());
    t.crons.saveCron(cron({ id: "c2" }));
    expect(t.crons.removeCron("c1")).toBe(true);
    expect(t.crons.listCrons().map((c) => c.id)).toEqual(["c2"]);
  });

  it("says no when there was no such cron, and leaves the file alone", async () => {
    const t = await load();
    t.crons.saveCron(cron());
    expect(t.crons.removeCron("nope")).toBe(false);
    expect(t.crons.listCrons()).toHaveLength(1);
  });
});
