import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/blastcp-auto.ts: the Weft account's access token to main's connectWeft, on sign-in and on a timer.

const t = vi.hoisted(() => ({
  session: null as { access_token: string } | null,
  listener: null as ((event: string) => void) | null,
  unsubscribe: vi.fn(),
  throwClient: false,
}));
vi.mock("./account", () => ({
  accountClient: () => {
    if (t.throwClient) throw new Error("Weft accounts aren't set up in this build yet.");
    return {
      auth: {
        getSession: () => Promise.resolve({ data: { session: t.session } }),
        onAuthStateChange: (cb: (event: string) => void) => {
          t.listener = cb;
          return { data: { subscription: { unsubscribe: t.unsubscribe } } };
        },
      },
    };
  },
}));
const shell = vi.hoisted(() => vi.fn());
vi.mock("./browser-tools", () => ({ shell }));
const syncBlastcpPlan = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
vi.mock("./blastcp-plan", () => ({ syncBlastcpPlan }));

const { connectBlastcpWithWeft, startBlastcpAuto } = await import("./blastcp-auto");

beforeEach(() => {
  vi.clearAllMocks();
  t.session = { access_token: "jwt" };
  t.throwClient = false;
  t.listener = null;
  vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:9");
  shell.mockResolvedValue({ state: "connected" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("connectBlastcpWithWeft", () => {
  it("sends the account's access token to main and returns what main says", async () => {
    expect(await connectBlastcpWithWeft()).toEqual({ state: "connected" });
    expect(shell).toHaveBeenCalledWith("/blastcp/connect-weft", { subjectToken: "jwt", force: false });
    await connectBlastcpWithWeft(true);
    expect(shell).toHaveBeenLastCalledWith("/blastcp/connect-weft", { subjectToken: "jwt", force: true });
  });

  it("is signed out with no session or no accounts, and unavailable outside the desktop app", async () => {
    t.session = null;
    expect(await connectBlastcpWithWeft()).toEqual({ state: "signed-out" });
    t.throwClient = true;
    expect(await connectBlastcpWithWeft()).toEqual({ state: "signed-out" });
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(await connectBlastcpWithWeft()).toEqual({ state: "unavailable" });
    expect(shell).not.toHaveBeenCalled();
  });
});

describe("startBlastcpAuto", () => {
  it("connects at once, on sign-in and twice a day, once per process, and stops", async () => {
    vi.useFakeTimers();
    const stop = startBlastcpAuto();
    expect(startBlastcpAuto()).toBe(stop);
    await vi.advanceTimersByTimeAsync(0);
    expect(shell).toHaveBeenCalledTimes(1);
    t.listener?.("TOKEN_REFRESHED");
    await vi.advanceTimersByTimeAsync(0);
    expect(shell).toHaveBeenCalledTimes(1);
    t.listener?.("SIGNED_IN");
    await vi.advanceTimersByTimeAsync(0);
    expect(shell).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(12 * 60 * 60_000);
    expect(shell).toHaveBeenCalledTimes(3);
    expect(syncBlastcpPlan).toHaveBeenCalledTimes(3);
    stop();
    expect(t.unsubscribe).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12 * 60 * 60_000);
    expect(shell).toHaveBeenCalledTimes(3);
  });

  it("logs a failure instead of throwing, and runs without accounts", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    shell.mockRejectedValue(new Error("BlastCP isn't set up"));
    t.throwClient = true;
    const stop = startBlastcpAuto();
    await vi.advanceTimersByTimeAsync(0);
    t.throwClient = false;
    t.session = { access_token: "jwt" };
    await vi.advanceTimersByTimeAsync(12 * 60 * 60_000);
    expect(warn).toHaveBeenCalledWith("BlastCP via Weft: BlastCP isn't set up");
    stop();
    warn.mockRestore();
  });
});
