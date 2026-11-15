import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api-client", () => api);

const { myDevices, signMacAsk } = await import("./mac-twins");
type View = Awaited<ReturnType<NonNullable<Parameters<typeof myDevices>[0]>>>;

const view = (devices: unknown[]) => ({ devices }) as unknown as View;

describe("myDevices", () => {
  it("lists every device of the view", async () => {
    const devices = [{ id: "a" }, { id: "b" }];
    expect(await myDevices(() => Promise.resolve(view(devices)))).toEqual(devices);
  });

  it("is empty when the read fails or there is no view", async () => {
    expect(await myDevices(() => Promise.reject(new Error("x")))).toEqual([]);
    expect(await myDevices(() => Promise.resolve(null as unknown as View))).toEqual([]);
  });

  it("reads /api/devices by default", async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(view([{ id: "a" }])) });
    expect(await myDevices()).toHaveLength(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/api/devices");
    api.apiFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    expect(await myDevices()).toEqual([]);
  });
});

describe("signMacAsk", () => {
  it("signs the ask for that Mac over the project, repo and name, and returns it with them", async () => {
    const sign = vi.fn(() => Promise.resolve({ kind: "ed25519" }));
    const args = { folder: "weft", origin: "me/weft", mac: "Studio" };
    expect(await signMacAsk("dev1", "weft", "me/weft", "Studio", sign as never)).toEqual({ origin: "me/weft", mac: "Studio", widen: { kind: "ed25519" } });
    expect(sign).toHaveBeenCalledWith({ host: "dev1", card: "", verb: "tree.snapshot", change: { wip: args }, args });
  });
});
