import { beforeEach, describe, expect, it, vi } from "vitest";

// The board's switch and event routes (app/api/telemetry) and the deployed collector (app/api/telemetry/collect),
// with lib/telemetry and lib/telemetry-send mocked.

vi.mock("next/server", () => ({ connection: async () => {} }));
// The guard reads the launch token; none here, so every check no-ops.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
const state = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/telemetry", () => ({ telemetryOn: () => state.on, setTelemetryOn: vi.fn((on: boolean) => (state.on = on)) }));
vi.mock("@/lib/telemetry-send", () => ({ forwardOnboarding: vi.fn(() => Promise.resolve(true)), captureOnboarding: vi.fn(() => Promise.resolve(204)) }));

const { GET, POST, PUT } = await import("./route");
const collect = await import("./collect/route");
const send = await import("@/lib/telemetry-send");

const URL_BASE = "http://localhost:3457/api/telemetry";
const req = (method: string, body?: unknown) =>
  new Request(URL_BASE, { method, headers: { host: "localhost:3457", "content-type": "application/json", "x-weft-token": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  state.on = true;
  vi.clearAllMocks();
});

describe("/api/telemetry", () => {
  it("reads and sets the switch", async () => {
    expect(await (await GET(req("GET"))).json()).toEqual({ on: true });
    expect(await (await PUT(req("PUT", { on: false }))).json()).toEqual({ on: false });
    expect(state.on).toBe(false);
  });

  it("refuses a switch that isn't true or false", async () => {
    expect((await PUT(req("PUT", { on: "yes" }))).status).toBe(400);
  });

  it("forwards an event and says whether it went", async () => {
    const res = await POST(req("POST", { event: "onboarding_step", props: { step: "first" } }));
    expect(await res.json()).toEqual({ sent: true });
    expect(send.forwardOnboarding).toHaveBeenCalledWith("onboarding_step", { step: "first" });
  });

  it("copes with a body that isn't JSON", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", headers: { host: "localhost:3457", "x-weft-token": "1" }, body: "x" }));
    expect(res.status).toBe(200);
    expect(send.forwardOnboarding).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe("/api/telemetry/collect", () => {
  it("hands the body to captureOnboarding and answers with its status", async () => {
    const res = await collect.POST(new Request("https://weft.zip/api/telemetry/collect", { method: "POST", body: JSON.stringify({ event: "onboarding_step" }) }));
    expect(res.status).toBe(204);
    expect(send.captureOnboarding).toHaveBeenCalledWith({ event: "onboarding_step" });
  });

  it("passes null for a body that isn't JSON", async () => {
    await collect.POST(new Request("https://weft.zip/api/telemetry/collect", { method: "POST", body: "nope" }));
    expect(send.captureOnboarding).toHaveBeenCalledWith(null);
  });
});
