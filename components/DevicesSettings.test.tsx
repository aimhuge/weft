// @vitest-environment jsdom
// Settings → Devices (components/DevicesSettings.tsx, lib/use-devices.ts): one list of every kind, Revoke routed by
// kind, and Add a worker's code polled until main says how it went.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-11-02T12:00:00Z") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));

const { default: DevicesSettings } = await import("./DevicesSettings");
const { POLL_MS, revokeRoute, repinOutcome, workerOutcome, useDevices, hostPairingBridge } = await import("@/lib/use-devices");

const base: DeviceView = {
  id: "m1", kind: "mac", name: "MacBook", platform: "darwin", orgId: "o", host: "h", hasBoxKey: true, hasSignKey: false, hasPasskey: false,
  approves: false, fingerprint: "fp", status: "online", lastSeenAt: "2026-11-02T11:55:00Z", revokedAt: null, note: null, build: null, here: true,
};
const dev = (over: Partial<DeviceView>): DeviceView => ({ ...base, ...over });
const DEVICES = [
  base,
  dev({ id: "w1", kind: "worker", name: "m1mini", hasSignKey: true, status: "offline", here: false, note: "Browser runs without sandbox: it runs as root." }),
  dev({ id: "p1", kind: "phone", name: "iPhone", hasSignKey: true, approves: true, status: null, here: false }),
  dev({ id: "p2", kind: "phone", name: "Old phone", status: null, lastSeenAt: null, here: false }),
  dev({ id: "b1", kind: "browser", name: "Chrome", revokedAt: "2026-11-02T10:00:00Z", status: null, here: false, note: "a revoked device's note stays off" }),
];

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
let pairing: { list: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };
let hosts: { start: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) => (url.includes("?id=") ? ok({ ok: true, kind: "worker" }) : ok({ signedIn: true, devices: DEVICES })));
  pairing = { list: vi.fn(() => Promise.resolve([{ id: "p1" }])), revoke: vi.fn(() => Promise.resolve({ ok: true })) };
  hosts = {
    start: vi.fn(() => Promise.resolve({ id: "c1", code: "wph.x", command: "curl -fsSL https://weft.zip/worker.sh | sh -s -- wph.x", expiresAt: 0 })),
    check: vi.fn(() => Promise.resolve({ status: "open" })),
    cancel: vi.fn(() => Promise.resolve()),
  };
  (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: hosts };
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("DevicesSettings", () => {
  it("lists every kind in one place with what each holds", async () => {
    render(<DevicesSettings />);
    expect(await screen.findByText("m1mini")).toBeInTheDocument();
    expect(screen.getByText("Mac · reads sealed threads · this Mac · Online")).toBeInTheDocument();
    expect(screen.getByText("Worker · paired · Seen 5m ago")).toBeInTheDocument();
    expect(screen.getByText("Phone · approves with Face ID · Seen 5m ago")).toBeInTheDocument();
    expect(screen.getByText("Phone · reads sealed threads · Never seen")).toBeInTheDocument();
    expect(screen.getByText("Browser · reads sealed threads · Revoked 2h ago")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke Chrome" })).toBeNull();
    expect(screen.getByText("Browser runs without sandbox: it runs as root.")).toBeInTheDocument();
    expect(screen.queryByText("a revoked device's note stays off")).toBeNull();
  });

  it("shows the version and commit each device runs, and flags one behind the newest", async () => {
    apiFetch.mockImplementation(() =>
      ok({ signedIn: true, devices: [dev({ build: "0.7.0+15388b1ffff" }), dev({ id: "w1", kind: "worker", name: "m1mini", hasSignKey: true, here: false, build: "0.6.6+abc1234" })] }),
    );
    render(<DevicesSettings />);
    expect(await screen.findByText("Mac · reads sealed threads · this Mac · Online · 0.7.0 (15388b1)")).toBeInTheDocument();
    expect(screen.getByText("Worker · paired · Online · 0.6.6 (abc1234, older)")).toBeInTheDocument();
  });

  it("revokes a phone this Mac pinned through main, and anything else through the registry", async () => {
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke iPhone" }));
    expect(pairing.revoke).toHaveBeenCalledWith("p1");
    await userEvent.click(screen.getByRole("button", { name: "Revoke m1mini" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/devices?id=w1", { method: "DELETE" }));
    expect(pairing.revoke).toHaveBeenCalledTimes(1);
  });

  it("re-pins a worker through main, and offers it only for workers", async () => {
    const forgetPin = vi.fn(() => Promise.resolve({ forgotten: true }));
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: { ...hosts, forgetPin } };
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Re-pin m1mini" }));
    expect(forgetPin).toHaveBeenCalledWith("w1", "m1mini");
    expect(await screen.findByText("Forgot m1mini's pinned keys: its next secret ask pins the keys it has now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-pin iPhone" })).toBeNull();
    expect(repinOutcome("m1mini", { denied: true })).toBe("Not re-pinned.");
    expect(repinOutcome("m1mini", { forgotten: false })).toBe("m1mini had no pinned keys on this Mac.");
  });

  it("lets this Mac's passkeys approve on a worker, after main endorses them", async () => {
    const endorse = vi.fn(() => Promise.resolve(null));
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: hosts, approval: { widen: vi.fn(), endorse } };
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Passkeys on m1mini" }));
    expect(endorse).toHaveBeenCalledWith({ worker: "w1", revoke: false });
    expect(await screen.findByText("Not approved, so m1mini trusts no new passkey.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Passkeys on iPhone" })).toBeNull();
  });

  it("drops the passkeys' outcome once Settings has closed", async () => {
    let finish: (v: null) => void = () => {};
    const endorse = vi.fn(() => new Promise<null>((r) => (finish = r)));
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: hosts, approval: { widen: vi.fn(), endorse } };
    const { unmount } = render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Passkeys on m1mini" }));
    unmount();
    finish(null);
    await waitFor(() => expect(endorse).toHaveBeenCalled());
  });

  it("approves a paired worker's re-pair through main and shows the line for the box", async () => {
    const approveRepair = vi.fn().mockResolvedValueOnce({ denied: true }).mockRejectedValueOnce(new Error("Error invoking remote method 'worker-repair:approve': Error: Paste the whole wph.… line")).mockResolvedValueOnce({ approval: "wra.1.a.b", command: "weft-worker enrol wph.y --re-pair --approval wra.1.a.b", fingerprint: "a1b2 c3d4 e5f6 7890" });
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: { ...hosts, approveRepair } };
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Re-pair m1mini" }));
    expect(screen.queryByRole("button", { name: "Re-pair iPhone" })).toBeNull();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "New pairing code for m1mini" }), "wph.y");
    await userEvent.click(approve);
    expect(approveRepair).toHaveBeenCalledWith("w1", "wph.y");
    expect(await screen.findByText("Not approved.")).toBeInTheDocument();
    await userEvent.click(approve);
    expect(await screen.findByText("Paste the whole wph.… line")).toBeInTheDocument();
    await userEvent.click(approve);
    expect(await screen.findByText("weft-worker enrol wph.y --re-pair --approval wra.1.a.b")).toBeInTheDocument();
    expect(screen.getByText(/Approved for the Mac a1b2 c3d4 e5f6 7890/)).toBeInTheDocument();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("weft-worker enrol wph.y --re-pair --approval wra.1.a.b");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(/Approved for the Mac/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Re-pair m1mini" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers no Re-pin without main's bridge for it", async () => {
    render(<DevicesSettings />);
    await screen.findByText("m1mini");
    expect(screen.queryByRole("button", { name: "Re-pin m1mini" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-pair m1mini" })).toBeNull();
  });

  it("shows why a revoke or a read failed", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.includes("?id=") ? Promise.resolve(new Response(JSON.stringify({ error: "That isn't one of your devices." }), { status: 502 })) : ok({ signedIn: true, devices: DEVICES }),
    );
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke m1mini" }));
    expect(await screen.findByText("That isn't one of your devices.")).toBeInTheDocument();
  });

  it("says when you're signed out, or the list can't be read", async () => {
    apiFetch.mockImplementationOnce(() => ok({ signedIn: false, devices: [] }));
    const { unmount } = render(<DevicesSettings />);
    expect(await screen.findByText("Sign in to Weft to see your devices.")).toBeInTheDocument();
    unmount();
    apiFetch.mockImplementationOnce(() => Promise.resolve(new Response("nope", { status: 500 })));
    render(<DevicesSettings />);
    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
  });

  it("adds a worker: shows the line, polls main, and says how it went", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hosts.check.mockResolvedValueOnce({ status: "open" }).mockResolvedValueOnce({ status: "paired", worker: { name: "m1mini", code: "AB12-CD34" } });
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    expect(await screen.findByText(/sh -s -- wph\.x/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(await screen.findByText("Added m1mini.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a worker" })).toBeInTheDocument();
  });

  it("copies the line and cancels the code", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("wph.x"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(hosts.cancel).toHaveBeenCalledWith("c1");
    expect(screen.getByRole("button", { name: "Add a worker" })).toBeInTheDocument();
  });

  it("reloads the list while open, and reads a non-Error failure as text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<DevicesSettings />);
    expect(await screen.findByText("m1mini")).toBeInTheDocument();
    apiFetch.mockRejectedValueOnce("offline");
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });

  it("says a worker's code failed, and a start that fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hosts.check.mockResolvedValueOnce({ status: "failed", error: "The claim wasn't made with this code." });
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Not added: The claim wasn't made with this code.")).toBeInTheDocument();
    hosts.start.mockRejectedValueOnce("no session");
    await userEvent.click(screen.getByRole("button", { name: "Add a worker" }));
    expect(await screen.findByText("no session")).toBeInTheDocument();
  });

  it("drops a read or a failure that lands after it closed", async () => {
    let finish: (r: Response) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    const { unmount } = render(<DevicesSettings />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    unmount();
    finish(new Response(JSON.stringify({ signedIn: true, devices: DEVICES })));
    let fail: (r: Response) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (fail = resolve)));
    const again = render(<DevicesSettings />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    again.unmount();
    fail(new Response("nope", { status: 500 }));
    let refuse: (e: Error) => void = () => {};
    hosts.start.mockReturnValueOnce(
      new Promise((_, reject: (e: Error) => void) => {
        refuse = reject;
      }),
    );
    const third = render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    third.unmount();
    refuse(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("late")).toBeNull();
  });

  it("offers no Add a worker outside the desktop app, and still revokes through the registry", async () => {
    delete (window as unknown as { weft?: unknown }).weft;
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke iPhone" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/devices?id=p1", { method: "DELETE" }));
    expect(screen.queryByRole("button", { name: "Add a worker" })).toBeNull();
  });
});

describe("use-devices helpers", () => {
  it("routes a pinned phone or browser through main, the rest through the registry", () => {
    const pinned = new Set(["p1", "b1"]);
    expect(revokeRoute({ id: "p1", kind: "phone" }, pinned)).toBe("pairing");
    expect(revokeRoute({ id: "b1", kind: "browser" }, pinned)).toBe("pairing");
    expect(revokeRoute({ id: "p9", kind: "phone" }, pinned)).toBe("registry");
    expect(revokeRoute({ id: "p1", kind: "worker" }, pinned)).toBe("registry");
  });

  it("says how a worker's code ended", () => {
    expect(workerOutcome({ status: "paired" })).toBe("Added the worker.");
    expect(workerOutcome({ status: "expired" })).toMatch(/expired/);
    expect(workerOutcome({ status: "failed", error: "bad proof" })).toBe("Not added: bad proof");
    expect(workerOutcome({ status: "failed" })).toMatch(/didn't check out/);
    expect(workerOutcome({ status: "cancelled" })).toBe("Not added.");
  });

  it("finds the bridge in the desktop app only", () => {
    expect(hostPairingBridge()).toBe(hosts);
    delete (window as unknown as { weft?: unknown }).weft;
    expect(hostPairingBridge()).toBeUndefined();
  });

  it("does nothing on Add a worker without a bridge, and keeps no state after unmount", async () => {
    function Probe() {
      const d = useDevices({});
      return (
        <button type="button" onClick={() => void d.addWorker().then(() => d.cancelWorker()).then(() => d.repin(DEVICES[1] as DeviceView))}>
          go
        </button>
      );
    }
    const { unmount } = render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(hosts.start).not.toHaveBeenCalled();
    unmount();
  });
});
