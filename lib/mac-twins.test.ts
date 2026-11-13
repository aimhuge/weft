import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api-client", () => api);

const { otherMacs, signMacAsk } = await import("./mac-twins");
type View = Awaited<ReturnType<NonNullable<Parameters<typeof otherMacs>[1]>>>;

const dev = (over: Record<string, unknown>) => ({ id: "x", name: "Studio", kind: "mac", here: false, revokedAt: null, host: "h".repeat(16), status: "online", ...over });
const view = (devices: unknown[]) => ({ devices }) as unknown as View;

describe("otherMacs", () => {
  it("lists the other, live Macs as menu twins, offline ones marked", async () => {
    const read = () =>
      Promise.resolve(
        view([
          dev({ host: "aa".repeat(8) }),
          dev({ name: "Mini", host: "bb".repeat(8), status: "busy" }),
          dev({ name: "Away", host: "cc".repeat(8), status: "offline" }),
          dev({ here: true }),
          dev({ revokedAt: "t" }),
          dev({ kind: "phone" }),
          dev({ host: null }),
        ]),
      );
    expect(await otherMacs("weft", read)).toEqual([
      { path: `mac:${"aa".repeat(8)}/weft`, name: "Studio", offline: false },
      { path: `mac:${"bb".repeat(8)}/weft`, name: "Mini", offline: false },
      { path: `mac:${"cc".repeat(8)}/weft`, name: "Away", offline: true },
    ]);
  });

  it("is empty when the read fails or there is no view", async () => {
    expect(await otherMacs("weft", () => Promise.reject(new Error("x")))).toEqual([]);
    expect(await otherMacs("weft", () => Promise.resolve(null as unknown as View))).toEqual([]);
  });

  it("reads /api/devices by default", async () => {
    api.apiFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(view([dev({ host: "dd".repeat(8) })])) });
    expect(await otherMacs("p")).toHaveLength(1);
    expect(api.apiFetch).toHaveBeenCalledWith("/api/devices");
    api.apiFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    expect(await otherMacs("p")).toEqual([]);
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
