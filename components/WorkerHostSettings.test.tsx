// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostSettings } from "@weft/client";

// A worker's own settings on Settings → Threads: pick one of your headless workers, its settings load from it, and
// Save sends only what changed. Nothing shows when you have no worker.
type Row = { id: string; name: string; mine: boolean; kind: string };
const workers = vi.hoisted(() => ({ list: new Array<Row>() }));
vi.mock("@/lib/use-workers", () => ({ useWorkers: () => ({ view: { signedIn: true, workers: workers.list } }) }));
const remote = vi.hoisted(() => ({ settings: new Map<string, HostSettings>() }));
vi.mock("@/lib/worker-host-settings", () => ({
  workerSettings: vi.fn((id: string, patch?: Partial<HostSettings>) => {
    const known = remote.settings.get(id);
    if (id === "bad" || !known) return Promise.reject(new Error("Your worker didn't answer. It may be offline."));
    const next = { ...known, ...patch };
    remote.settings.set(id, next);
    return Promise.resolve(next);
  }),
}));

const { workerSettings } = await import("@/lib/worker-host-settings");
const { default: WorkerHostSettings } = await import("./WorkerHostSettings");

const base: HostSettings = { maxThreads: 6, keepAliveMinutes: 0, worktreePool: 1, defaultBackend: "claude" };

beforeEach(() => {
  vi.clearAllMocks();
  workers.list = [
    { id: "w1", name: "m1mini", mine: true, kind: "headless" },
    { id: "w2", name: "box", mine: true, kind: "headless" },
    { id: "d1", name: "laptop", mine: true, kind: "desktop" },
    { id: "t1", name: "theirs", mine: false, kind: "headless" },
  ];
  remote.settings = new Map([["w1", { ...base }], ["w2", { ...base, maxThreads: 7, keepAliveMinutes: 45 }]]);
});
afterEach(cleanup);

describe("WorkerHostSettings", () => {
  it("draws nothing without a worker of yours", () => {
    workers.list = [{ id: "t1", name: "theirs", mine: false, kind: "headless" }];
    const { container } = render(<WorkerHostSettings />);
    expect(container.textContent).toBe("");
  });

  it("loads the first worker's settings and saves only what changed", async () => {
    render(<WorkerHostSettings />);
    expect(screen.getByRole("combobox", { name: "Worker" }).querySelectorAll("option")).toHaveLength(2);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Threads running at once" })).toBeTruthy());
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save on worker" });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Threads running at once" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Ready worktrees per repo" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Default CLI" }), { target: { value: "puku" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Keep conversations open" }), { target: { value: "60" } });
    fireEvent.click(save);
    await waitFor(() => expect(workerSettings).toHaveBeenLastCalledWith("w1", { maxThreads: 3, worktreePool: 0, defaultBackend: "puku", keepAliveMinutes: 60 }));
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save on worker" }).disabled).toBe(true));
  });

  it("keeps a value off the menus on them, and switches worker", async () => {
    render(<WorkerHostSettings />);
    fireEvent.change(screen.getByRole("combobox", { name: "Worker" }), { target: { value: "w2" } });
    await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Threads running at once" }).value).toBe("7"));
    expect(screen.getByRole("option", { name: "45 minutes" })).toBeTruthy();
    expect(workerSettings).toHaveBeenCalledWith("w2");
  });

  it("says when the worker didn't answer, and when a save failed", async () => {
    workers.list = [{ id: "bad", name: "gone", mine: true, kind: "headless" }];
    render(<WorkerHostSettings />);
    await waitFor(() => expect(screen.getByText("Your worker didn't answer. It may be offline.")).toBeTruthy());
    cleanup();
    workers.list = [{ id: "w1", name: "m1mini", mine: true, kind: "headless" }];
    render(<WorkerHostSettings />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Threads running at once" })).toBeTruthy());
    vi.mocked(workerSettings).mockRejectedValueOnce(new Error("maxThreads must be a whole number."));
    fireEvent.change(screen.getByRole("combobox", { name: "Threads running at once" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save on worker" }));
    await waitFor(() => expect(screen.getByText("maxThreads must be a whole number.")).toBeTruthy());
  });
});
