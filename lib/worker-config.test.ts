import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkerConfig, workRoot, workerDataDir, workerHome, workerSealKeys, writeWorkerConfig, writeWorkerEnv, type WorkerConfig } from "./worker-config";

// The env a worker reads: a partial one, with NODE_ENV filled in the way Next types it.
const env = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...vars });

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-config-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const config = (over: Partial<WorkerConfig> = {}): WorkerConfig => ({
  workerId: "w-1",
  orgId: "org-1",
  ownerUser: "u-1",
  device: "worker:w-1",
  key: "wwk_secret",
  name: "mini",
  ...over,
});

describe("workerHome", () => {
  it("is ~/.weft-worker by default", () => {
    expect(workerHome(env({}))).toBe(path.join(os.homedir(), ".weft-worker"));
  });

  it("is WEFT_WORKER_HOME when it is set", () => {
    expect(workerHome(env({ WEFT_WORKER_HOME: "/srv/weft-worker" }))).toBe("/srv/weft-worker");
  });

  it("falls back when WEFT_WORKER_HOME is empty", () => {
    expect(workerHome(env({ WEFT_WORKER_HOME: "" }))).toBe(path.join(os.homedir(), ".weft-worker"));
  });
});

describe("workerDataDir", () => {
  it("is the data folder under the home", () => {
    expect(workerDataDir("/srv/worker")).toBe(path.join("/srv/worker", "data"));
  });
});

describe("workRoot", () => {
  it("is work inside the worker home by default", () => {
    expect(workRoot("/h", env({}))).toBe(path.join("/h", "work"));
  });

  it("is WEFT_WORKER_ROOT when it is set", () => {
    expect(workRoot("/h", env({ WEFT_WORKER_ROOT: "/srv/work" }))).toBe("/srv/work");
  });

  it("falls back when WEFT_WORKER_ROOT is empty", () => {
    expect(workRoot("/h", env({ WEFT_WORKER_ROOT: "" }))).toBe(path.join("/h", "work"));
  });
});

describe("readWorkerConfig", () => {
  it("is null when there is no file", () => {
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("is null when the file is damaged", () => {
    fs.writeFileSync(path.join(home, "worker.json"), "{not json");
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("is null when the file holds something else", () => {
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify({ hello: "world" }));
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("is null when a field is missing or empty", () => {
    const noKey: Record<string, unknown> = { ...config() };
    delete noKey.key;
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(noKey));
    expect(readWorkerConfig(home)).toBeNull();

    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(config({ key: "" })));
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("is null when a field isn't a string", () => {
    fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(config({ workerId: 7 as unknown as string })));
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("is null when the file holds null", () => {
    fs.writeFileSync(path.join(home, "worker.json"), "null");
    expect(readWorkerConfig(home)).toBeNull();
  });

  it("reads the enrolled worker back", () => {
    writeWorkerConfig(home, config());
    expect(readWorkerConfig(home)).toEqual(config());
  });
});

describe("writeWorkerConfig", () => {
  it("writes the config as JSON with the worker in it", () => {
    writeWorkerConfig(home, config());
    const raw = fs.readFileSync(path.join(home, "worker.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(config());
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("makes the home and the file private", () => {
    writeWorkerConfig(home, config());
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(home, "worker.json")).mode & 0o777).toBe(0o600);
  });

  it("makes the home when it isn't there yet", () => {
    const nested = path.join(home, "deep", "worker");
    writeWorkerConfig(nested, config());
    expect(fs.existsSync(path.join(nested, "worker.json"))).toBe(true);
  });

  it("keeps the file at 600 when it was there with looser permissions", () => {
    const file = path.join(home, "worker.json");
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    writeWorkerConfig(home, config());
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe("writeWorkerEnv", () => {
  const file = () => path.join(home, "worker.env");

  it("writes KEY='value' lines at mode 600", () => {
    writeWorkerEnv(home, { CLAUDE_CODE_OAUTH_TOKEN: "tok" });
    expect(fs.readFileSync(file(), "utf8")).toBe("CLAUDE_CODE_OAUTH_TOKEN='tok'\n");
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });

  it("replaces a key it writes again, keeps the others, and drops quotes from a value", () => {
    fs.writeFileSync(file(), "OTHER='1'\nCLAUDE_CODE_OAUTH_TOKEN='old'\n", { mode: 0o644 });
    writeWorkerEnv(home, { CLAUDE_CODE_OAUTH_TOKEN: "n'ew" });
    expect(fs.readFileSync(file(), "utf8")).toBe("OTHER='1'\nCLAUDE_CODE_OAUTH_TOKEN='new'\n");
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });
});

describe("workerSealKeys", () => {
  const file = () => path.join(home, "seal-key.json");
  const pair = { publicKey: "pub", privateKey: "priv" };

  it("makes a pair the first time, at mode 600, and reads it back after", () => {
    const make = vi.fn(() => pair);
    expect(workerSealKeys(home, make)).toEqual(pair);
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(workerSealKeys(home, () => ({ publicKey: "other", privateKey: "other" }))).toEqual(pair);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("makes a fresh pair when the file is damaged", () => {
    fs.writeFileSync(file(), "{not json");
    expect(workerSealKeys(home, () => pair)).toEqual(pair);
    fs.writeFileSync(file(), JSON.stringify({ publicKey: 1 }));
    expect(workerSealKeys(home, () => ({ publicKey: "b", privateKey: "c" }))).toEqual({ publicKey: "b", privateKey: "c" });
  });
});
