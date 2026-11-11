// @vitest-environment jsdom
// Settings → Devices → Move threads to… (components/WorkerMoveThreads.tsx through DevicesSettings and lib/use-devices.ts):
// a revoked or offline worker that owns threads hands them to another, and Revoke on a worker that owns threads asks
// first and can move them before it revokes.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { DeviceView } from "@/lib/device-registry";

vi.mock("@/lib/use-now", () => ({ useNow: () => Date.parse("2026-11-02T12:00:00Z") }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));
const connectors = vi.hoisted(() => ({ view: { signedIn: true, github: { connected: false }, connectUrl: "", workers: {} }, error: null, note: null, canChange: true }));
vi.mock("@/lib/use-worker-connectors", () => ({ useWorkerConnectors: () => connectors }));

const { default: DevicesSettings } = await import("./DevicesSettings");

const worker = (over: Partial<DeviceView>): DeviceView => ({
  id: "w", kind: "worker", name: "box", platform: "darwin", orgId: "o", host: null, hasBoxKey: true, hasSignKey: false, hasPasskey: false,
  approves: false, fingerprint: null, status: "online", lastSeenAt: "2026-11-02T11:55:00Z", revokedAt: null, note: null, build: null, here: false, threads: 0,
  ...over,
});
const OLD = worker({ id: "old", name: "m1mini (old)", status: "offline", revokedAt: "2026-11-02T10:00:00Z", threads: 38 });
const NEW = worker({ id: "new", name: "m1mini" });
const SPARE = worker({ id: "spare", name: "spare", status: "offline" });
const BUSY = worker({ id: "busy", name: "busy box", threads: 1 });

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let devices: DeviceView[];

beforeEach(() => {
  devices = [OLD, NEW, SPARE, BUSY];
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return ok({ ok: true, moved: 38 });
    if (init?.method === "DELETE") return ok({ ok: true, kind: "worker" });
    return ok({ signedIn: true, devices });
  });
  delete (window as unknown as { weft?: unknown }).weft;
});

const calls = () => apiFetch.mock.calls as [string, RequestInit | undefined][];
const posted = () => calls().filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init?.body as string) as unknown);
const deleted = () => calls().filter(([, init]) => init?.method === "DELETE").map(([url]) => url);

describe("Move threads to…", () => {
  it("counts a worker's threads and offers the move on a revoked one, listing your other live workers", async () => {
    render(<DevicesSettings />);
    expect(await screen.findByText(/38 threads · Revoked 2h ago/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move busy box's threads" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Move m1mini (old)'s threads" }));
    const select = screen.getByRole("combobox", { name: "Move m1mini (old)'s threads to" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["m1mini", "spare · offline", "busy box"]);
    await userEvent.selectOptions(select, "spare");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByText("Moved 38 threads from m1mini (old) to spare.")).toBeInTheDocument();
    expect(posted()).toEqual([{ from: "old", to: "spare" }]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("closes on Cancel, and says why a move was refused", async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? ok({ error: "Couldn't move those threads: That worker was revoked." }, 502) : ok({ signedIn: true, devices })));
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Move m1mini (old)'s threads" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Move m1mini (old)'s threads" }));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByText("Couldn't move those threads: That worker was revoked.")).toBeInTheDocument();
  });

  it("says when there was nothing left to move", async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? ok({ ok: true }) : ok({ signedIn: true, devices })));
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Move m1mini (old)'s threads" }));
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByText("m1mini (old) had no threads to move.")).toBeInTheDocument();
  });
});

describe("Revoke on a worker that owns threads", () => {
  it("asks first, and moves them before it revokes", async () => {
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Forget busy box" }));
    expect(deleted()).toEqual([]);
    expect(screen.getByRole("group", { name: "Revoke busy box?" })).toHaveTextContent("busy box owns 1 thread. Move them to");
    await userEvent.click(screen.getByRole("button", { name: "Move and revoke" }));
    await waitFor(() => expect(deleted()).toEqual(["/api/devices?id=busy"]));
    expect(posted()).toEqual([{ from: "busy", to: "new" }]);
  });

  it("can leave them, or cancel", async () => {
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Forget busy box" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Forget busy box" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move busy box's threads to" }), "");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(deleted()).toEqual(["/api/devices?id=busy"]));
    expect(posted()).toEqual([]);
  });

  it("keeps the move's note beside what the revoke reports", async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return ok({ ok: true, moved: 1 });
      if (init?.method === "DELETE") return ok({ ok: true, kind: "worker", note: "GitHub off" });
      return ok({ signedIn: true, devices });
    });
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Forget busy box" }));
    await userEvent.click(screen.getByRole("button", { name: "Move and revoke" }));
    expect(await screen.findByText("Moved 1 thread from busy box to m1mini. busy box: GitHub off")).toBeInTheDocument();
  });

  it("doesn't revoke when the move fails", async () => {
    apiFetch.mockImplementation((url: string, init?: RequestInit) => (init?.method === "POST" ? ok({ error: "nope" }, 502) : ok({ signedIn: true, devices })));
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Forget busy box" }));
    await userEvent.click(screen.getByRole("button", { name: "Move and revoke" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(deleted()).toEqual([]);
  });

  it("says the threads stay when there's no other worker to take them", async () => {
    devices = [BUSY];
    render(<DevicesSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Forget busy box" }));
    expect(screen.getByRole("group")).toHaveTextContent("They stay under it until you move them to another worker.");
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(deleted()).toEqual(["/api/devices?id=busy"]));
  });
});
