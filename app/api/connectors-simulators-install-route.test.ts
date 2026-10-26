import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Simulators → Install: the route behind the panel's Install buttons. The guard and
// the install lib are mocked, so the route's own dispatch — the guard, the key check and the jobs — is pinned.

const state = vi.hoisted(() => ({ denied: false }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/guard", () => ({
  guard: () => (state.denied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) => Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));
vi.mock("@/lib/simulator-install", () => ({
  installJobs: vi.fn(() => ({})),
  isInstallKey: (key: unknown) => ["axe", "runtime", "xcode-select", "android"].includes(key as string),
  startInstall: vi.fn(() => ({ status: "running", line: "Starting…" })),
}));
vi.mock("@/lib/simulator-install-steps", () => ({
  INSTALLERS: { axe: vi.fn(), runtime: vi.fn(), "xcode-select": vi.fn(), android: vi.fn() },
}));

const install = await import("@/lib/simulator-install");
const route = await import("./connectors/simulators/install/route");

const URL = "http://localhost:3457/api/connectors/simulators/install";

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
});

describe("GET /api/connectors/simulators/install", () => {
  it("returns the jobs that are running or finished", async () => {
    vi.mocked(install.installJobs).mockReturnValueOnce({ axe: { status: "running", line: "Downloading AXe" } });
    const res = await route.GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ axe: { status: "running", line: "Downloading AXe" } });
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    const res = await route.GET(new Request(URL));
    expect(res.status).toBe(403);
    expect(install.installJobs).not.toHaveBeenCalled();
  });
});

describe("POST /api/connectors/simulators/install", () => {
  it("starts the install for a key it knows", async () => {
    const res = await route.POST(new Request(URL, { method: "POST", body: JSON.stringify({ key: "axe" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running", line: "Starting…" });
    expect(install.startInstall).toHaveBeenCalledWith("axe", expect.any(Object));
  });

  it("refuses a key it doesn't know", async () => {
    const res = await route.POST(new Request(URL, { method: "POST", body: JSON.stringify({ key: "xcode" }) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Weft can't install xcode.");
    expect(install.startInstall).not.toHaveBeenCalled();
  });

  it("refuses a request without a key", async () => {
    const res = await route.POST(new Request(URL, { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Weft can't install undefined.");
  });

  it("refuses a request whose body isn't JSON", async () => {
    const res = await route.POST(new Request(URL, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Weft can't install undefined.");
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    const res = await route.POST(new Request(URL, { method: "POST", body: JSON.stringify({ key: "axe" }) }));
    expect(res.status).toBe(403);
    expect(install.startInstall).not.toHaveBeenCalled();
  });
});
