// @vitest-environment jsdom
// Settings → Devices, a worker's sealing (components/DevicesSettings.tsx WorkerSeal, lib/use-devices.ts): Seal… through
// main, the line it leaves, a revoke dropping the grant, and the offer right after a worker pairs.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-11-02T12:00:00Z") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));
vi.mock("@/lib/use-worker-connectors", () => ({ useWorkerConnectors: () => ({ view: { signedIn: true, github: { connected: false }, connectUrl: "", workers: {} }, error: null, note: null, canChange: true }) }));

const { default: DevicesSettings } = await import("./DevicesSettings");
const { POLL_MS } = await import("@/lib/use-devices");

const worker: DeviceView = {
  id: "w1", kind: "worker", name: "m1mini", platform: "linux", orgId: "o", host: "h", hasBoxKey: true, hasSignKey: true, hasPasskey: false,
  approves: false, fingerprint: "fp", status: "offline", lastSeenAt: "2026-11-02T11:55:00Z", revokedAt: null, note: null, build: null, here: false, threads: 0,
};
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
type Status = { sealOn: boolean; workers: Record<string, { version: number; latest: number }> };
let status: Status;
const pairing = { list: vi.fn(() => Promise.resolve([])), revoke: vi.fn() };
const base = () => ({
  start: vi.fn(() => Promise.resolve({ id: "c1", code: "wph.x", command: "sh -s -- wph.x", expiresAt: 0 })),
  check: vi.fn(() => Promise.resolve({ status: "open" })),
  cancel: vi.fn(() => Promise.resolve()),
  keyStatus: vi.fn(() => Promise.resolve(status)),
  dropKeys: vi.fn(() => Promise.resolve({ dropped: true })),
  grantKey: vi.fn((id: string) => {
    status = { sealOn: true, workers: { [id]: { version: 3, latest: 3 } } };
    return Promise.resolve({ version: 3 });
  }),
});
let hosts: ReturnType<typeof base>;

beforeEach(() => {
  status = { sealOn: true, workers: {} };
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) => (url.includes("?id=") ? ok({ ok: true, kind: "worker" }) : ok({ signedIn: true, devices: [worker] })));
  hosts = base();
  (window as unknown as { weft: unknown }).weft = { pairing, hostPairing: hosts };
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("a worker's sealing in Settings → Devices", () => {
  it("seals a paired worker's threads through main, says which key it holds, and drops it on Revoke", async () => {
    // The first read fails (signed out in main): the list still draws, in the clear.
    hosts.keyStatus.mockRejectedValueOnce(new Error("out"));
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Seal m1mini's threads" }));
    expect(hosts.grantKey).toHaveBeenCalledWith("w1");
    expect(await screen.findByText("m1mini now holds key v3: it seals what it publishes from now on.")).toBeInTheDocument();
    expect(await screen.findByText("Worker · paired · Seen 5m ago · Threads sealed (key v3)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Seal m1mini's threads" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Revoke m1mini" }));
    await waitFor(() => expect(hosts.dropKeys).toHaveBeenCalledWith("w1"));
  });

  it("offers the key right after a worker pairs, while your Mac seals", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hosts.check.mockResolvedValueOnce({ status: "paired", worker: { id: "w2", name: "box", code: "AB12" } } as never);
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Added box. box now holds key v3: it seals what it publishes from now on.")).toBeInTheDocument();
    expect(hosts.grantKey).toHaveBeenCalledWith("w2");
  });

  it("says why a pairing's seal failed, and offers nothing while your Mac doesn't seal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hosts.grantKey.mockRejectedValueOnce(new Error("Touch ID failed"));
    hosts.check.mockResolvedValue({ status: "paired", worker: { id: "w2", name: "box", code: "AB12" } } as never);
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Added box. Not sealed: Touch ID failed")).toBeInTheDocument();
    status = { sealOn: false, workers: {} };
    await userEvent.click(await screen.findByRole("button", { name: "Add a worker" }));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText("Added box.")).toBeInTheDocument();
    expect(hosts.grantKey).toHaveBeenCalledTimes(1);
  });
});
