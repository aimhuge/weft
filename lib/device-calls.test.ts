// The Mac's side of manual QA mode (lib/device-calls.ts): a worker's call is untrusted, so it needs a live grant,
// its arguments are re-read, and the device comes from the grant, never from the row.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const simulatorTools = vi.hoisted(() => vi.fn());
const listDevices = vi.hoisted(() => vi.fn());
const bootedDevice = vi.hoisted(() => vi.fn());
const recentCrashes = vi.hoisted(() => vi.fn());
const downloadBuild = vi.hoisted(() => vi.fn());
const unpackBuild = vi.hoisted(() => vi.fn());
const sweepBuilds = vi.hoisted(() => vi.fn());
const deviceId = vi.hoisted(() => vi.fn());
const requireGrant = vi.hoisted(() => vi.fn());

vi.mock("./simulator-tools", () => ({ simulatorTools }));
vi.mock("./simulator-devices", () => ({ listDevices, bootedDevice }));
vi.mock("./simulator-crashes", () => ({ recentCrashes }));
vi.mock("./device-build", () => ({ downloadBuild, unpackBuild, sweepBuilds }));
vi.mock("./device-id", () => ({ deviceId }));
vi.mock("./qa-grants", () => ({ requireGrant }));

const { drainDeviceCalls, runDeviceCall } = await import("./device-calls");
type DeviceCallRow = import("./device-calls").DeviceCallRow;

const DEVICE = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" } as never;

const row = (over: Partial<DeviceCallRow> = {}): DeviceCallRow => ({
  id: "call-1",
  worker_id: "worker-1",
  card_id: "card-1",
  tool: "tap",
  args: { element: "Login" },
  ...over,
});

// A tool the module can run, whose handler says what it was given.
type ToolAnswer = { content: { type: string; text: string }[]; isError?: boolean };
const tool = (name: string, result: ToolAnswer = { content: [{ type: "text", text: "tapped" }] }) => {
  const handler = vi.fn(() => Promise.resolve(result));
  simulatorTools.mockReturnValue([{ name, handler }]);
  return handler;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireGrant.mockReturnValue({ cardId: "card-1", workerId: "worker-1", device: "udid-1", name: "iPhone 17", until: Date.now() + 1_000_000 });
  listDevices.mockResolvedValue([DEVICE]);
  bootedDevice.mockResolvedValue(DEVICE);
  recentCrashes.mockResolvedValue("");
  deviceId.mockReturnValue("mac-1");
  sweepBuilds.mockImplementation(() => undefined);
});

describe("runDeviceCall", () => {
  it("throws when there's no grant for the call", async () => {
    requireGrant.mockImplementation(() => {
      throw new Error("Manual QA isn't switched on for this thread on this Mac.");
    });
    await expect(runDeviceCall({} as never, row())).rejects.toThrow("isn't switched on");
  });

  it("refuses a tool that can't reach this Mac", async () => {
    await expect(runDeviceCall({} as never, row({ tool: "shell" }))).rejects.toThrow("can't reach this Mac");
  });

  it("refuses a device tool this Mac has no handler for", async () => {
    simulatorTools.mockReturnValue([]);
    await expect(runDeviceCall({} as never, row({ tool: "tap" }))).rejects.toThrow("can't reach this Mac");
  });

  it("uses the device the grant names, not the one the row names", async () => {
    const handler = tool("tap");
    await runDeviceCall({} as never, row({ args: { element: "Login", device: "other-device" } }));
    expect(handler).toHaveBeenCalledWith({ element: "Login", device: "udid-1" }, {});
  });

  it("refuses to open this Mac's localhost", async () => {
    tool("open_url");
    await expect(runDeviceCall({} as never, row({ tool: "open_url", args: { url: "http://localhost:3000" } }))).rejects.toThrow("can't open this Mac's localhost");
    await expect(runDeviceCall({} as never, row({ tool: "open_url", args: { url: "http://127.0.0.1:3000" } }))).rejects.toThrow("can't open this Mac's localhost");
  });

  it("opens a URL that isn't this Mac", async () => {
    const handler = tool("open_url");
    await runDeviceCall({} as never, row({ tool: "open_url", args: { url: "https://example.test" } }));
    expect(handler).toHaveBeenCalledWith({ url: "https://example.test", device: "udid-1" }, {});
  });

  it("opens a URL that isn't a URL at all", async () => {
    const handler = tool("open_url");
    await runDeviceCall({} as never, row({ tool: "open_url", args: { url: "not a url" } }));
    expect(handler).toHaveBeenCalledWith({ url: "not a url", device: "udid-1" }, {});
  });

  it("lists only the device the grant names", async () => {
    listDevices.mockResolvedValue([
      { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted", runtime: "iOS 18.2" },
      { id: "udid-2", name: "iPad", platform: "ios", state: "shutdown", runtime: "iOS 18.2" },
    ]);
    const out = await runDeviceCall({} as never, row({ tool: "list_devices", args: {} }));
    expect((out.content[0] as { text: string }).text).toContain("iPhone 17");
    expect((out.content[0] as { text: string }).text).not.toContain("iPad");
  });

  it("lists the granted device by its name too", async () => {
    listDevices.mockResolvedValue([{ id: "other-udid", name: "iPhone 17", platform: "ios", state: "booted" }]);
    const out = await runDeviceCall({} as never, row({ tool: "list_devices", args: {} }));
    expect((out.content[0] as { text: string }).text).toContain("iPhone 17");
  });

  it("hands the card's id to the tool factory", async () => {
    const handler = tool("tap");
    // simulatorTools takes a callback that names the card the tools are for; it should be called with the card's id.
    simulatorTools.mockImplementation((card: () => string) => {
      expect(card()).toBe("card-1");
      return [{ name: "tap", handler }];
    });
    await runDeviceCall({} as never, row());
    expect(handler).toHaveBeenCalled();
  });

  it("asks the route without a token when the client has no session", async () => {
    tool("install");
    const sha = "a".repeat(64);
    downloadBuild.mockResolvedValue("/tmp/qa-builds/x.download");
    unpackBuild.mockResolvedValue("/tmp/qa-builds/x/MyApp.app");
    const { client } = fakeClient({ session: null });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: "https://r2.test/qa-builds/o/w/sha" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await runDeviceCall(client, row({ id: "11111111-1111-1111-1111-111111111111", tool: "install", args: { build: { sha, kind: "app", bytes: 5 } } }));

    expect(fetchMock).toHaveBeenCalledWith("https://weft.zip/api/worker-build?call=11111111-1111-1111-1111-111111111111", {
      headers: { authorization: "Bearer " },
    });
    vi.unstubAllGlobals();
  });

  it("lists a device with no runtime by its platform", async () => {
    listDevices.mockResolvedValue([{ id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" }]);
    const out = await runDeviceCall({} as never, row({ tool: "list_devices", args: {} }));
    expect((out.content[0] as { text: string }).text).toContain("ios");
  });

  it("lists a device by its runtime when it has one", async () => {
    listDevices.mockResolvedValue([{ id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted", runtime: "iOS 18.2" }]);
    const out = await runDeviceCall({} as never, row({ tool: "list_devices", args: {} }));
    expect((out.content[0] as { text: string }).text).toContain("iOS 18.2");
  });

  it("says so when the granted device isn't on this Mac anymore", async () => {
    listDevices.mockResolvedValue([]);
    const out = await runDeviceCall({} as never, row({ tool: "list_devices", args: {} }));
    expect((out.content[0] as { text: string }).text).toBe("iPhone 17 isn't on this Mac anymore.");
  });

  it("appends the crash reports to the logs", async () => {
    tool("logs", { content: [{ type: "text", text: "log lines" }] });
    recentCrashes.mockResolvedValue("MyApp: EXC_BAD_ACCESS");
    const out = await runDeviceCall({} as never, row({ tool: "logs", args: { app: "MyApp" } }));
    expect(out.content).toHaveLength(2);
    expect((out.content[1] as { text: string }).text).toContain("Crash reports:");
    expect((out.content[1] as { text: string }).text).toContain("EXC_BAD_ACCESS");
  });

  it("leaves the logs alone when there are no crashes", async () => {
    tool("logs", { content: [{ type: "text", text: "log lines" }] });
    const out = await runDeviceCall({} as never, row({ tool: "logs", args: { app: "MyApp" } }));
    expect(out.content).toHaveLength(1);
  });

  it("asks for the crashes of the whole device when the call names no app", async () => {
    tool("logs", { content: [{ type: "text", text: "log lines" }] });
    await runDeviceCall({} as never, row({ tool: "logs", args: {} }));
    expect(recentCrashes).toHaveBeenCalledWith(DEVICE, undefined, expect.any(Number));
  });

  it("leaves the logs alone when they failed", async () => {
    tool("logs", { content: [{ type: "text", text: "no logs" }], isError: true });
    const out = await runDeviceCall({} as never, row({ tool: "logs", args: {} }));
    expect(out.content).toHaveLength(1);
    expect(out.isError).toBe(true);
  });

  it("fetches the build from the route and installs the unpacked path", async () => {
    tool("install");
    const sha = "a".repeat(64);
    downloadBuild.mockResolvedValue("/tmp/qa-builds/x.download");
    unpackBuild.mockResolvedValue("/tmp/qa-builds/x/MyApp.app");
    const { client } = fakeClient();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: "https://r2.test/qa-builds/o/w/sha" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await runDeviceCall(client, row({ id: "11111111-1111-1111-1111-111111111111", tool: "install", args: { build: { sha, kind: "app", bytes: 5 } } }));

    expect(fetchMock).toHaveBeenCalledWith("https://weft.zip/api/worker-build?call=11111111-1111-1111-1111-111111111111", {
      headers: { authorization: "Bearer token-1" },
    });
    expect(downloadBuild).toHaveBeenCalledWith("https://r2.test/qa-builds/o/w/sha", { sha, kind: "app", bytes: 5 });
    expect(unpackBuild).toHaveBeenCalledWith("/tmp/qa-builds/x.download", { sha, kind: "app", bytes: 5 });
    vi.unstubAllGlobals();
  });

  it("says so when the route won't give the build", async () => {
    tool("install");
    const { client } = fakeClient();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "That build isn't yours to read." }), { status: 404 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      runDeviceCall(client, row({ id: "11111111-1111-1111-1111-111111111111", tool: "install", args: { build: { sha: "a".repeat(64), kind: "app", bytes: 5 } } })),
    ).rejects.toThrow("isn't yours to read");
    vi.unstubAllGlobals();
  });

  it("says so when the route's answer isn't even json", async () => {
    tool("install");
    const { client } = fakeClient();
    const fetchMock = vi.fn(() => Promise.resolve(new Response("not json", { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      runDeviceCall(client, row({ id: "11111111-1111-1111-1111-111111111111", tool: "install", args: { build: { sha: "a".repeat(64), kind: "app", bytes: 5 } } })),
    ).rejects.toThrow("Couldn't find the build: HTTP 500");
    vi.unstubAllGlobals();
  });
});

// A Supabase client with the chained methods this module uses, and the calls it makes recorded.
interface FakeCalls {
  updates: Array<{ patch: Record<string, unknown>; eqs: string[] }>;
  selects: string[];
}

function fakeClient({ session = "token-1", pending = [] as DeviceCallRow[], claimable = true, selectError = null as { message: string } | null, answerError = null as { message: string } | null }: { session?: string | null; pending?: DeviceCallRow[]; claimable?: boolean; selectError?: { message: string } | null; answerError?: { message: string } | null } = {}) {
  const calls: FakeCalls = { updates: [], selects: [] };
  const table = () => {
    // The chain: update().eq().eq().select() for a claim, update().eq() for an answer,
    // select().eq().eq().eq().order().limit().overrideTypes() for the pending rows.
    const chain: Record<string, unknown> = {};
    // The answer's chain ends at the first eq(), and the claim's at the second.
    const first = {
      then: (resolve: (v: unknown) => unknown) => resolve({ error: answerError }),
    } as Record<string, unknown>;
    chain.eq = vi.fn(() => ({
      ...first,
      eq: vi.fn((column: string) => {
        calls.updates.at(-1)?.eqs.push(column);
        return { select: vi.fn(() => Promise.resolve({ data: claimable ? [{ id: "call-1" }] : [], error: null })) };
      }),
    }));
    chain.update = vi.fn((patch: Record<string, unknown>) => {
      calls.updates.push({ patch, eqs: [] });
      return chain;
    });
    chain.select = vi.fn((columns: string) => {
      calls.selects.push(columns);
      const q = {
        eq: vi.fn(() => q),
        order: vi.fn(() => q),
        limit: vi.fn(() => q),
        overrideTypes: vi.fn(() => Promise.resolve(selectError ? { data: null, error: selectError } : { data: pending, error: null })),
      };
      return q;
    });
    return chain;
  };
  const client = {
    auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: session === null ? null : { access_token: session } } })) },
    from: vi.fn(() => table()),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("drainDeviceCalls", () => {
  it("claims a pending row, runs it, and answers it done", async () => {
    tool("tap");
    const { client, calls } = fakeClient({ pending: [row()] });
    await drainDeviceCalls(client, "user-1");
    expect(deviceId).toHaveBeenCalled();
    // The claim set status claimed, then the answer set status done.
    expect(calls.updates.map((u) => u.patch.status)).toEqual(["claimed", "done"]);
    expect(calls.updates.at(-1)?.patch).toMatchObject({ status: "done" });
  });

  it("skips a row it can't claim", async () => {
    tool("tap");
    const { client, calls } = fakeClient({ pending: [row()], claimable: false });
    await drainDeviceCalls(client, "user-1");
    // Only the claim happened: no answer was written.
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]?.patch).toEqual({ status: "claimed" });
  });

  it("reports a failed call with the error", async () => {
    requireGrant.mockImplementation(() => {
      throw new Error("Manual QA isn't switched on.");
    });
    const { client, calls } = fakeClient({ pending: [row()] });
    await drainDeviceCalls(client, "user-1");
    expect(calls.updates.at(-1)?.patch).toMatchObject({ status: "failed", error: "Manual QA isn't switched on." });
  });

  it("says nothing when the database has no device_calls table yet", async () => {
    const { client, calls } = fakeClient({ selectError: { message: "no table" } });
    await expect(drainDeviceCalls(client, "user-1")).resolves.toBeUndefined();
    expect(calls.updates).toHaveLength(0);
  });

  it("carries on when the answer can't be written", async () => {
    tool("tap");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, calls } = fakeClient({ pending: [row()], answerError: { message: "row is gone" } });
    await expect(drainDeviceCalls(client, "user-1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Manual QA: couldn't answer call-1: row is gone");
    expect(calls.updates[0]?.patch).toEqual({ status: "claimed" });
    warn.mockRestore();
  });

  it("drains once at a time, and a nudge while it drains loops again", async () => {
    tool("tap");
    let passes = 0;
    const { client } = fakeClient({ pending: [row()] });
    // The second drain, asked for while the first is still going, only sets the flag.
    const original = (client.from as unknown as ReturnType<typeof vi.fn>).getMockImplementation();
    (client.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      passes += 1;
      return (original as () => unknown)();
    });
    const first = drainDeviceCalls(client, "user-1");
    const second = drainDeviceCalls(client, "user-1");
    await Promise.all([first, second]);
    expect(passes).toBeGreaterThanOrEqual(1);
  });
});
