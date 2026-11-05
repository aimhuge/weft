// @vitest-environment jsdom
// Settings → Devices → a worker's Secrets (components/WorkerKeep.tsx, lib/use-worker-keep.ts): off until the warning is
// ticked, names only on screen, and main's answers read back plainly. Revoking a worker asks main to wipe it first.
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "./test-utils";
import { WorkerKeep } from "./WorkerKeep";
import { keepOutcome, plainError, useWorkerKeep, workerKeepBridge, type KeepList, type WorkerKeepBridge } from "@/lib/use-worker-keep";

const LIST: KeepList = {
  kept: [{ repo: "github:o/r", label: "o/r", environment: "development", names: ["A", "B"] }],
  repos: [
    { id: "github:o/r", label: "o/r" },
    { id: "github:o/s", label: "o/s" },
  ],
  environments: ["development", "preview"],
};
let bridge: { [K in keyof WorkerKeepBridge]: Mock<WorkerKeepBridge[K]> };
const device = { id: "w1", name: "m1mini" };

beforeEach(() => {
  bridge = {
    list: vi.fn<WorkerKeepBridge["list"]>(() => Promise.resolve(LIST)),
    keep: vi.fn<WorkerKeepBridge["keep"]>(() => Promise.resolve({ kept: ["A"], label: "o/s" })),
    stop: vi.fn<WorkerKeepBridge["stop"]>(() => Promise.resolve({ sent: true, name: "m1mini" })),
    wipe: vi.fn<WorkerKeepBridge["wipe"]>(() => Promise.resolve({ sent: false, name: "m1mini" })),
  };
  (window as unknown as { weft: unknown }).weft = { workerKeep: bridge };
});
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("WorkerKeep", () => {
  it("shows what's kept, keeps nothing until the warning is ticked, then keeps the chosen project", async () => {
    const onClose = vi.fn();
    render(<WorkerKeep device={device} onClose={onClose} />);
    expect(await screen.findByText("o/r · development · 2 secrets")).toBeInTheDocument();
    expect(screen.getByText(/code a thread runs there can read/)).toBeInTheDocument();
    const keep = screen.getByRole("button", { name: "Keep on this worker" });
    expect(keep).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Project"), "github:o/s");
    await userEvent.selectOptions(screen.getByLabelText("Environment"), "preview");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(keep);
    expect(bridge.keep).toHaveBeenCalledWith({ worker: "w1", repo: "github:o/s", environment: "preview" });
    expect(await screen.findByText("Sent 1 secret of o/s (preview) to m1mini. Each use still asks you here.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop keeping o/r development on m1mini" }));
    expect(bridge.stop).toHaveBeenCalledWith({ worker: "w1", repo: "github:o/r", environment: "development" });
    expect(await screen.findByText("m1mini will delete its copy as soon as it takes the command.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wipe all" }));
    expect(await screen.findByText("Forgotten here; that worker was revoked.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the first project by default, shows main's errors plainly, and says when nothing is kept", async () => {
    bridge.list.mockImplementation(() => Promise.resolve({ ...LIST, kept: [] }));
    bridge.keep.mockImplementation(() => Promise.reject(new Error("Error invoking remote method 'worker-keep:keep': Error: m1mini was revoked.")));
    bridge.stop.mockImplementation(() => Promise.resolve({ sent: false, name: "m1mini" }));
    bridge.wipe.mockImplementation(() => Promise.resolve({ sent: true, name: "m1mini" }));
    render(<WorkerKeep device={device} onClose={() => {}} />);
    expect(await screen.findByText("Nothing kept on m1mini: every secret travels per use.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Keep on this worker" }));
    expect(bridge.keep).toHaveBeenCalledWith({ worker: "w1", repo: "github:o/r", environment: "development" });
    expect(await screen.findByText("m1mini was revoked.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wipe all" }));
    expect(await screen.findByText("m1mini will delete everything this Mac kept there.")).toBeInTheDocument();
  });

  it("shows a list error, and nothing without the bridge", async () => {
    bridge.list.mockImplementation(() => Promise.reject(new Error("locked")));
    const { unmount } = render(<WorkerKeep device={device} onClose={() => {}} />);
    expect(await screen.findByText("locked")).toBeInTheDocument();
    unmount();
    delete (window as unknown as { weft?: unknown }).weft;
    const { container } = render(<WorkerKeep device={device} onClose={() => {}} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("uses a bridge it's handed, and a stop that couldn't be sent says so", async () => {
    const given = { ...bridge, list: vi.fn(() => Promise.resolve({ ...LIST, environments: undefined as unknown as string[] })), stop: vi.fn(() => Promise.resolve({ sent: false, name: "m1mini" })) } as unknown as WorkerKeepBridge;
    delete (window as unknown as { weft?: unknown }).weft;
    render(<WorkerKeep device={device} onClose={() => {}} bridge={given} />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop keeping o/r development on m1mini" }));
    expect(await screen.findByText("Forgotten here; that worker was revoked.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "preview" })).toBeInTheDocument();
  });
});

describe("use-worker-keep's words", () => {
  it("reads each outcome", () => {
    expect(keepOutcome("m", "development", { denied: true, label: "o/r" })).toBe("Not approved, so nothing was sent.");
    expect(keepOutcome("m", "preview", { none: true, label: "o/r" })).toBe("o/r has no preview values to keep.");
    expect(keepOutcome("m", "development", { kept: ["A", "B"], label: "o/r" })).toBe("Sent 2 secrets of o/r (development) to m. Each use still asks you here.");
    expect(plainError("x")).toBe("x");
    expect(workerKeepBridge()).toBe(bridge);
  });
});

describe("useWorkerKeep without a bridge", () => {
  it("does nothing", async () => {
    delete (window as unknown as { weft?: unknown }).weft;
    const { result } = renderHook(() => useWorkerKeep("w1", "m1mini", undefined));
    await act(() => result.current.wipe());
    expect(result.current).toMatchObject({ available: false, list: null, note: null });
  });
});
