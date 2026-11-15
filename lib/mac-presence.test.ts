import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shell = vi.fn<(route: string) => Promise<Record<string, unknown>>>();
const accountClient = vi.fn<() => unknown>();
const syncFolders = vi.fn(() => ["/repo"]);
vi.mock("./browser-shell", () => ({ shell: (route: string) => shell(route) }));
vi.mock("./account", () => ({ accountClient: () => accountClient() }));
vi.mock("./settings", () => ({ syncFolders: () => syncFolders() }));
vi.mock("./device-id", () => ({ deviceId: () => "mac-1" }));

const { beatPresence, startMacPresence, PRESENCE_EVERY_MS } = await import("./mac-presence");

function fakeClient({ user = "u1", error = null }: { user?: string | null; error?: unknown } = {}) {
  const upsert = vi.fn(() => Promise.resolve({ error }));
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: user ? { user: { id: user } } : null } }) },
    from: vi.fn(() => ({ upsert })),
  };
  return { client: client as never, upsert, from: client.from };
}

const deps = (over: Partial<Parameters<typeof beatPresence>[0] & object> = {}) => ({
  client: () => fakeClient().client,
  idleSeconds: () => Promise.resolve(12),
  syncOn: () => true,
  deviceId: () => "mac-1",
  ...over,
});

describe("beatPresence", () => {
  it("upserts this Mac's idle seconds", async () => {
    const f = fakeClient();
    await expect(beatPresence(deps({ client: () => f.client }))).resolves.toBe(true);
    expect(f.from).toHaveBeenCalledWith("device_presence");
    expect(f.upsert).toHaveBeenCalledWith({ user_id: "u1", device_id: "mac-1", idle_seconds: 12 }, { onConflict: "user_id,device_id" });
  });

  it("skips quietly when sync is off, signed out, or there's no idle time", async () => {
    const f = fakeClient();
    await expect(beatPresence(deps({ syncOn: () => false, client: () => f.client }))).resolves.toBe(false);
    await expect(beatPresence(deps({ client: () => null }))).resolves.toBe(false);
    await expect(beatPresence(deps({ client: () => fakeClient({ user: null }).client }))).resolves.toBe(false);
    await expect(beatPresence(deps({ client: () => f.client, idleSeconds: () => Promise.resolve(null) }))).resolves.toBe(false);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("swallows a database error and an offline throw", async () => {
    await expect(beatPresence(deps({ client: () => fakeClient({ error: { message: "no table" } }).client }))).resolves.toBe(false);
    await expect(beatPresence(deps({ idleSeconds: () => Promise.reject(new Error("offline")) }))).resolves.toBe(false);
  });
});

describe("the default wiring", () => {
  const before = process.env.WEFT_SHELL_URL;
  beforeEach(() => {
    shell.mockReset();
    accountClient.mockReset();
    syncFolders.mockReturnValue(["/repo"]);
  });
  afterEach(() => {
    if (before === undefined) delete process.env.WEFT_SHELL_URL;
    else process.env.WEFT_SHELL_URL = before;
  });

  it("reads idle from Electron main and writes with the account client", async () => {
    process.env.WEFT_SHELL_URL = "http://127.0.0.1:1";
    const f = fakeClient();
    accountClient.mockReturnValue(f.client);
    shell.mockResolvedValue({ idleSeconds: 7.6 });
    await expect(beatPresence()).resolves.toBe(true);
    expect(shell).toHaveBeenCalledWith("/system/idle");
    expect(f.upsert).toHaveBeenCalledWith({ user_id: "u1", device_id: "mac-1", idle_seconds: 8 }, { onConflict: "user_id,device_id" });
  });

  it("skips with no desktop shell, a bad answer, no sync folders, or no account", async () => {
    accountClient.mockReturnValue(fakeClient().client);
    delete process.env.WEFT_SHELL_URL;
    await expect(beatPresence()).resolves.toBe(false);
    process.env.WEFT_SHELL_URL = "http://127.0.0.1:1";
    shell.mockResolvedValue({ idleSeconds: "x" });
    await expect(beatPresence()).resolves.toBe(false);
    syncFolders.mockReturnValue([]);
    await expect(beatPresence()).resolves.toBe(false);
    syncFolders.mockReturnValue(["/repo"]);
    accountClient.mockImplementation(() => {
      throw new Error("no account");
    });
    await expect(beatPresence()).resolves.toBe(false);
  });
});

describe("startMacPresence", () => {
  it("beats now and every minute until stopped", async () => {
    vi.useFakeTimers();
    const beat = vi.fn(() => Promise.resolve(12));
    const stop = startMacPresence(deps({ idleSeconds: beat }));
    await vi.advanceTimersByTimeAsync(PRESENCE_EVERY_MS * 2);
    expect(beat).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(PRESENCE_EVERY_MS * 2);
    expect(beat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
