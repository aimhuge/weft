import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

// We expose a real ServiceRefused class so the route's `instanceof` check fires for real.
const ServiceRefused = class ServiceRefused extends Error {};
const killProc = vi.hoisted(() => vi.fn<(pid: number) => Promise<void>>());
const killService = vi.hoisted(() => vi.fn<(id: string) => Promise<void>>());
vi.mock("@/lib/services-kill", () => ({
  ServiceRefused,
  killProc: (pid: number) => killProc(pid),
  killService: (id: string) => killService(id),
}));

const restartDev = vi.hoisted(() => vi.fn<(cardId: string) => Promise<void>>());
vi.mock("@/lib/devserver", () => ({
  restartDev: (cardId: string) => restartDev(cardId),
}));

const listServices = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock("@/lib/services-snapshot", () => ({
  listServices: () => listServices(),
  machineInfo: () => ({ cores: 10, memKb: 16 * 1024 * 1024 }),
}));

// Dev launchers: a real LaunchRefused class for the route's `instanceof` check, plus listLaunchers and launch.
const LaunchRefused = class LaunchRefused extends Error {};
const listLaunchers = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const launch = vi.hoisted(() => vi.fn<(cwd: string, command: string) => Promise<{ result: "started" | "restarted"; id: string }>>());
vi.mock("@/lib/worker-dev-list", () => ({ workerDevServers: () => Promise.resolve([{ workerId: "w1", worker: "m1mini", servers: [] }]) }));
vi.mock("@/lib/dev-launchers", () => ({
  LaunchRefused,
  listLaunchers: () => listLaunchers(),
  launch: (cwd: string, command: string) => launch(cwd, command),
}));

const route = await import("./services/route");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listServices.mockResolvedValue([{ id: "weft", kind: "weft" }]);
  listLaunchers.mockResolvedValue([]);
  killProc.mockResolvedValue(undefined);
  killService.mockResolvedValue(undefined);
  restartDev.mockResolvedValue(undefined);
  launch.mockResolvedValue({ result: "started", id: "dev:folder:/dev/deckcp" });
});

describe("GET /api/services", () => {
  it("lists the services without needing x-weft-token", async () => {
    const res = await route.GET(req("/services", { headers: READ }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { services: { id: string }[]; machine: unknown };
    expect(json.services).toEqual([{ id: "weft", kind: "weft" }]);
    expect(json.machine).toEqual({ cores: 10, memKb: 16 * 1024 * 1024 });
    expect(listServices).toHaveBeenCalled();
  });

  it("returns the dev launchers from listLaunchers", async () => {
    const launchers = [{ cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev" }] }];
    listLaunchers.mockResolvedValueOnce(launchers);
    const res = await route.GET(req("/services", { headers: READ }));
    const json = (await res.json()) as { launchers: typeof launchers };
    expect(res.status).toBe(200);
    expect(json.launchers).toEqual(launchers);
    expect(listLaunchers).toHaveBeenCalled();
  });

  it("returns your workers' dev servers", async () => {
    const json = (await (await route.GET(req("/services", { headers: READ }))).json()) as { workers: unknown };
    expect(json.workers).toEqual([{ workerId: "w1", worker: "m1mini", servers: [] }]);
  });

  it("rejects a foreign host", async () => {
    const res = await route.GET(req("/services", { headers: { host: "attacker.test" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/services", () => {
  const post = (body: unknown, headers: Record<string, string> = WRITE) => route.POST(req("/services", { method: "POST", body, headers }));

  it("denies a write without x-weft-token", async () => {
    const res = await post({ action: "kill", id: "cli:c1" }, { host: "localhost:3457", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(killService).not.toHaveBeenCalled();
    expect(killProc).not.toHaveBeenCalled();
  });

  it("rejects a foreign host even with the header", async () => {
    const res = await post(
      { action: "kill", id: "cli:c1" },
      { host: "evil.test", "x-weft-token": "1", "content-type": "application/json" },
    );
    expect(res.status).toBe(403);
  });

  it("kills a service by id", async () => {
    const res = await post({ action: "kill", id: "cli:c1" });
    expect(res.status).toBe(200);
    expect(killService).toHaveBeenCalledWith("cli:c1");
    expect(killProc).not.toHaveBeenCalled();
  });

  it("kills a single process by pid", async () => {
    const res = await post({ action: "kill", pid: 4242 });
    expect(res.status).toBe(200);
    expect(killProc).toHaveBeenCalledWith(4242);
    expect(killService).not.toHaveBeenCalled();
  });

  it("restarts a dev server when the id starts with dev:", async () => {
    const res = await post({ action: "restart", id: "dev:c1" });
    expect(res.status).toBe(200);
    expect(restartDev).toHaveBeenCalledWith("c1");
  });

  it("launches a folder's dev command and returns { ok, result, id }", async () => {
    launch.mockResolvedValueOnce({ result: "started", id: "dev:folder:/dev/deckcp" });
    const res = await post({ action: "launch", cwd: "/dev/deckcp", command: "pnpm dev" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: "started", id: "dev:folder:/dev/deckcp" });
    expect(launch).toHaveBeenCalledWith("/dev/deckcp", "pnpm dev");
  });

  it("maps a LaunchRefused from launch to 403", async () => {
    launch.mockRejectedValueOnce(new LaunchRefused("That folder isn't one of the board's."));
    const res = await post({ action: "launch", cwd: "/dev/other", command: "pnpm dev" });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/isn't one of the board's/);
  });

  it("refuses a restart whose id is not a dev: id", async () => {
    const res = await post({ action: "restart", id: "cli:c1" });
    expect(res.status).toBe(400);
    expect(restartDev).not.toHaveBeenCalled();
  });

  it("400s an unknown action, or bad JSON, and skips every call", async () => {
    for (const body of [{ action: "hack", id: "cli:c1" }, { action: "kill" }, "{}"]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(killService).not.toHaveBeenCalled();
    expect(killProc).not.toHaveBeenCalled();
    expect(restartDev).not.toHaveBeenCalled();
  });

  it("maps ServiceRefused to 403", async () => {
    killService.mockRejectedValueOnce(new ServiceRefused("That's Weft itself: quit Weft to end it."));
    const res = await post({ action: "kill", id: "weft" });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/Weft itself/);
  });

  it("maps a ServiceRefused from killProc to 403", async () => {
    killProc.mockRejectedValueOnce(new ServiceRefused("Process 99 isn't one Weft started."));
    const res = await post({ action: "kill", pid: 99 });
    expect(res.status).toBe(403);
  });

  it("rethrows errors that aren't ServiceRefused so the framework 500s them", async () => {
    killService.mockRejectedValueOnce(new Error("boom"));
    await expect(post({ action: "kill", id: "cli:c1" })).rejects.toThrow("boom");
  });
});
