// @vitest-environment jsdom
// Settings → Devices → a paired worker's Secrets (components/WorkerKeep.tsx): the button opens the panel, and revoking a
// worker asks main to wipe what this Mac kept there first.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-11-02T12:00:00Z") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));
const connectors = vi.hoisted(() => ({ view: { signedIn: true, github: { connected: false }, connectUrl: "", workers: {} }, error: null, note: null, canChange: true }));
vi.mock("@/lib/use-worker-connectors", () => ({ useWorkerConnectors: () => connectors }));

const { default: DevicesSettings } = await import("./DevicesSettings");

const base: DeviceView = {
  id: "m1", kind: "mac", name: "MacBook", platform: "darwin", orgId: "o", host: "h", hasBoxKey: true, hasSignKey: false, hasPasskey: false,
  approves: false, fingerprint: "fp", status: "online", lastSeenAt: "2026-11-02T11:55:00Z", revokedAt: null, note: null, build: null, here: true, threads: 0,
};
const DEVICES = [base, { ...base, id: "w1", kind: "worker" as const, name: "m1mini", hasSignKey: true, here: false }, { ...base, id: "p1", kind: "phone" as const, name: "iPhone", here: false }];
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
let pairing: { list: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };
let hosts: { start: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

beforeEach(() => {
  apiFetch.mockReset();
  pairing = { list: vi.fn(() => Promise.resolve([])), revoke: vi.fn(() => Promise.resolve({ ok: true })) };
  hosts = { start: vi.fn(), check: vi.fn(() => Promise.resolve({ status: "open" })), cancel: vi.fn(() => Promise.resolve()) };
});
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("DevicesSettings → Secrets", () => {
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

});
