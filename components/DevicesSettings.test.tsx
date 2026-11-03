// @vitest-environment jsdom
// Settings → Devices (components/DevicesSettings.tsx, lib/use-devices.ts): one list of every kind, Revoke routed by
// kind, and Add a worker's code polled until main says how it went. The hook's pure words are lib/use-devices.test.ts.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-11-02T12:00:00Z") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));
// A worker's Connectors badge has its own hook and tests (lib/use-worker-connectors.test.ts, WorkerConnectors.test.tsx).
const connectors = vi.hoisted(() => ({ view: { signedIn: true, github: { connected: false }, connectUrl: "", workers: {} }, error: null, note: null, canChange: true }));
vi.mock("@/lib/use-worker-connectors", () => ({ useWorkerConnectors: () => connectors }));

const { default: DevicesSettings } = await import("./DevicesSettings");
const { POLL_MS, useDevices, hostPairingBridge } = await import("@/lib/use-devices");

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
    expect(screen.getByText("Worker · paired · Seen 5m ago · Threads in the clear")).toBeInTheDocument();
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
    expect(screen.getByText("Worker · paired · Online · 0.6.6 (abc1234, older) · Threads in the clear")).toBeInTheDocument();
  });

  it("revokes a phone this Mac pinned through main, and anything else through the registry", async () => {
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke iPhone" }));
    expect(pairing.revoke).toHaveBeenCalledWith("p1");
    await userEvent.click(screen.getByRole("button", { name: "Revoke m1mini" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/devices?id=w1", { method: "DELETE" }));
    expect(pairing.revoke).toHaveBeenCalledTimes(1);
  });

  it("opens a paired worker's Secrets, and wipes what this Mac kept there before revoking it", async () => {
    const order: string[] = [];
    const workerKeep = {
      list: vi.fn(() => Promise.resolve({ kept: [], repos: [], environments: ["development"] })),
      keep: vi.fn(),
      stop: vi.fn(),
      wipe: vi.fn(() => (order.push("wipe"), Promise.reject(new Error("offline")))),
    };
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: hosts, workerKeep };
    apiFetch.mockImplementation((url: string) => (url.includes("?id=") ? (order.push("revoke"), ok({ ok: true, kind: "worker" })) : ok({ signedIn: true, devices: DEVICES })));
    render(<DevicesSettings />);
    expect(screen.queryByRole("button", { name: "Secrets kept on iPhone" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Secrets kept on m1mini" }));
    expect(await screen.findByText("Nothing kept on m1mini: every secret travels per use.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/every secret travels per use/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Revoke m1mini" }));
    await waitFor(() => expect(order).toEqual(["wipe", "revoke"]));
    expect(workerKeep.wipe).toHaveBeenCalledWith("w1");
  });

  it("shows a paired worker's Connectors badge, and what GitHub confirmed when it's revoked", async () => {
    apiFetch.mockImplementation((url: string) => (url.includes("?id=") ? ok({ ok: true, kind: "worker", note: "GitHub off · 1 token revoked ✓" }) : ok({ signedIn: true, devices: DEVICES })));
    render(<DevicesSettings />);
    expect(await screen.findByRole("button", { name: "Connectors on m1mini" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connectors on iPhone" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Revoke m1mini" }));
    expect(await screen.findByText("m1mini: GitHub off · 1 token revoked ✓")).toBeInTheDocument();
  });

  it("drops a revoke's note that lands after it closed", async () => {
    let answer: (r: Response) => void = () => {};
    apiFetch.mockImplementation((url: string) => (url.includes("?id=") ? new Promise<Response>((resolve) => (answer = resolve)) : ok({ signedIn: true, devices: DEVICES })));
    const { unmount } = render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke m1mini" }));
    unmount();
    answer(new Response(JSON.stringify({ ok: true, kind: "worker", note: "late note" })));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("m1mini: late note")).toBeNull();
  });

  it("re-pins a worker through main, and offers it only for workers", async () => {
    const forgetPin = vi.fn(() => Promise.resolve({ forgotten: true }));
    (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: { ...hosts, forgetPin } };
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Re-pin m1mini" }));
    expect(forgetPin).toHaveBeenCalledWith("w1", "m1mini");
    expect(await screen.findByText("Forgot m1mini's pinned keys: its next secret ask pins the keys it has now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-pin iPhone" })).toBeNull();
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
