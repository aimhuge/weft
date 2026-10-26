import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron, CronInput, CronPatch } from "@/lib/cron-types";

// The crons API (app/api/crons): the rail's Crons drawer and the ⏰ popover. Every write needs
// x-weft-token; the list needs none when no launch token exists.

const listCrons = vi.hoisted(() => vi.fn<() => Cron[]>());
const getCron = vi.hoisted(() => vi.fn<(id: string) => Cron | undefined>());
vi.mock("@/lib/cron-store", () => ({ listCrons, getCron }));

const createCron = vi.hoisted(() => vi.fn<(input: CronInput, now?: number) => Cron>());
const updateCron = vi.hoisted(() => vi.fn<(id: string, patch: CronPatch, now?: number) => Cron>());
const deleteCron = vi.hoisted(() => vi.fn<(id: string) => void>());
vi.mock("@/lib/crons", () => ({ createCron, updateCron, deleteCron }));

// The card a run makes (lib/cron-run.ts returns one).
type RunCard = { id: string; cronRun?: number; title: string };
const runCron = vi.hoisted(() => vi.fn<(id: string, now?: number) => Promise<RunCard>>());
vi.mock("@/lib/cron-run", () => ({ runCron }));

const route = await import("./crons/route");
const idRoute = await import("./crons/[id]/route");
const runRoute = await import("./crons/[id]/run/route");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const cron = (over: Partial<Cron> = {}): Cron => ({
  id: "c1",
  name: "Digest",
  prompt: "p",
  expr: "0 9 * * *",
  mode: "fresh",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 0,
  runs: [],
  nextAt: 1000,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listCrons.mockReturnValue([]);
  createCron.mockImplementation((input) => cron({ id: "new-1", name: input.name ?? "Digest" }));
  updateCron.mockImplementation((id) => cron({ id }));
  deleteCron.mockImplementation(() => {});
  runCron.mockResolvedValue({ id: "card-1", cronRun: 1, title: "Digest" });
});

describe("GET /api/crons", () => {
  it("lists the crons without needing x-weft-token", async () => {
    listCrons.mockReturnValue([cron()]);
    const res = route.GET(req("/crons", { headers: READ }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { crons: { id: string }[] };
    expect(json.crons).toHaveLength(1);
    expect(json.crons[0]?.id).toBe("c1");
  });

  it("lists them soonest run first, and a cron with no run last", async () => {
    listCrons.mockReturnValue([
      cron({ id: "later", nextAt: 5000 }),
      cron({ id: "none", nextAt: undefined }),
      cron({ id: "soon", nextAt: 1000 }),
    ]);
    const res = route.GET(req("/crons", { headers: READ }));
    const json = (await res.json()) as { crons: { id: string }[] };
    expect(json.crons.map((c) => c.id)).toEqual(["soon", "later", "none"]);
  });

  it("rejects a foreign host", () => {
    const res = route.GET(req("/crons", { headers: { host: "attacker.test" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/crons", () => {
  const post = (body: unknown, headers: Record<string, string> = WRITE) => route.POST(req("/crons", { method: "POST", body, headers }));

  it("denies a write without x-weft-token", async () => {
    const res = await post({ prompt: "p", expr: "0 9 * * *" }, { host: "localhost:3457", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(createCron).not.toHaveBeenCalled();
  });

  it("rejects a foreign host even with the header", async () => {
    const res = await post({ prompt: "p", expr: "0 9 * * *" }, { host: "evil.test", "x-weft-token": "1", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(createCron).not.toHaveBeenCalled();
  });

  it("makes the cron and returns it", async () => {
    const res = await post({ prompt: "p", expr: "0 9 * * *" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { cron: { id: string } };
    expect(json.cron.id).toBe("new-1");
    expect(createCron).toHaveBeenCalledWith(expect.objectContaining({ prompt: "p", expr: "0 9 * * *", by: "you" }));
  });

  it("does not run it right away by default", async () => {
    await post({ prompt: "p", expr: "0 9 * * *" });
    expect(runCron).not.toHaveBeenCalled();
  });

  it("fires the first run when it was asked to, and answers with the cron as it stands after it", async () => {
    getCron.mockReturnValue({ ...cron({ id: "new-1" }), count: 1 });
    const res = await post({ prompt: "p", expr: "0 9 * * *", runNow: true });
    expect(res.status).toBe(200);
    expect(runCron).toHaveBeenCalledWith("new-1");
    expect(((await res.json()) as { cron: Cron }).cron.count).toBe(1);
  });

  it("answers with the cron it made when the run's write can't be read back", async () => {
    getCron.mockReturnValue(undefined);
    const res = await post({ prompt: "p", expr: "0 9 * * *", runNow: true });
    expect(((await res.json()) as { cron: Cron }).cron.id).toBe("new-1");
  });

  it("says what went wrong with a bad cron", async () => {
    createCron.mockImplementation(() => {
      throw new Error("Write what each run should do.");
    });
    const res = await post({ prompt: "", expr: "0 9 * * *" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Write what each run should do.");
  });

  it("says what went wrong when the first run can't start", async () => {
    runCron.mockRejectedValue(new Error("No such cron."));
    const res = await post({ prompt: "p", expr: "0 9 * * *", runNow: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No such cron.");
  });
});

describe("PATCH /api/crons/[id]", () => {
  const patch = (body: unknown, headers: Record<string, string> = WRITE) => idRoute.PATCH(req("/crons/c1", { method: "PATCH", body, headers }), ctx("c1"));

  it("denies a write without x-weft-token", async () => {
    const res = await patch({ name: "x" }, { host: "localhost:3457", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(updateCron).not.toHaveBeenCalled();
  });

  it("rejects a foreign host even with the header", async () => {
    const res = await patch({ name: "x" }, { host: "evil.test", "x-weft-token": "1", "content-type": "application/json" });
    expect(res.status).toBe(403);
    expect(updateCron).not.toHaveBeenCalled();
  });

  it("changes the cron and returns it", async () => {
    const res = await patch({ name: "New", enabled: false });
    expect(res.status).toBe(200);
    expect(updateCron).toHaveBeenCalledWith("c1", { name: "New", enabled: false });
    expect(((await res.json()) as { cron: { id: string } }).cron.id).toBe("c1");
  });

  it("says what went wrong with a bad change", async () => {
    updateCron.mockImplementation(() => {
      throw new Error("No such cron.");
    });
    const res = await patch({ name: "x" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No such cron.");
  });
});

describe("DELETE /api/crons/[id]", () => {
  const del = (headers: Record<string, string> = WRITE) => idRoute.DELETE(req("/crons/c1", { method: "DELETE", headers }), ctx("c1"));

  it("denies a write without x-weft-token", async () => {
    const res = await del({ host: "localhost:3457" });
    expect(res.status).toBe(403);
    expect(deleteCron).not.toHaveBeenCalled();
  });

  it("rejects a foreign host even with the header", async () => {
    const res = await del({ host: "evil.test", "x-weft-token": "1" });
    expect(res.status).toBe(403);
    expect(deleteCron).not.toHaveBeenCalled();
  });

  it("deletes the cron and says it did", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(deleteCron).toHaveBeenCalledWith("c1");
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("says what went wrong for a cron that isn't there", async () => {
    deleteCron.mockImplementation(() => {
      throw new Error("No such cron.");
    });
    const res = await del();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No such cron.");
  });
});

describe("POST /api/crons/[id]/run", () => {
  const post = (headers: Record<string, string> = WRITE) => runRoute.POST(req("/crons/c1/run", { method: "POST", headers }), ctx("c1"));

  it("denies a write without x-weft-token", async () => {
    const res = await post({ host: "localhost:3457" });
    expect(res.status).toBe(403);
    expect(runCron).not.toHaveBeenCalled();
  });

  it("rejects a foreign host even with the header", async () => {
    const res = await post({ host: "evil.test", "x-weft-token": "1" });
    expect(res.status).toBe(403);
    expect(runCron).not.toHaveBeenCalled();
  });

  it("fires the run and returns its card", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(runCron).toHaveBeenCalledWith("c1");
    expect(((await res.json()) as { card: { id: string } }).card.id).toBe("card-1");
  });

  it("says what went wrong when the run can't start", async () => {
    runCron.mockRejectedValue(new Error("No such cron."));
    const res = await post();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No such cron.");
  });
});
