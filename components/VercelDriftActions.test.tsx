// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VercelBridge, VercelEnvRow } from "@/lib/vercel-view";
import "./test-utils";
import VercelDriftActions from "./VercelDriftActions";

// Pull and Push beside a drift line: each answers its half of the drift, toasts and reloads.

const ROWS: VercelEnvRow[] = [
  { name: "PLAIN", environment: "preview", inVault: false, onVercel: true, pullable: true },
  { name: "A", environment: "production", inVault: true, onVercel: false },
];

function setup(over: Partial<VercelBridge> = {}, rows = ROWS) {
  const bridge = {
    envPull: vi.fn(() => Promise.resolve({ label: "o/web", project: "web", pulled: [{ name: "PLAIN", environment: "preview" }], skipped: [] })),
    envPushAll: vi.fn(() => Promise.resolve({ label: "o/web", project: "web", sent: [{ name: "A", environment: "production" }], failed: [] })),
    ...over,
  } as unknown as VercelBridge;
  const notify = vi.fn();
  const onDone = vi.fn(() => Promise.resolve());
  render(<VercelDriftActions folder="/web" rows={rows} bridge={bridge} notify={notify} onDone={onDone} />);
  return { bridge, notify, onDone };
}

describe("VercelDriftActions", () => {
  it("previews the pull, then pulls what Vercel can hand back and reloads", async () => {
    const { bridge, notify, onDone } = setup(undefined, [...ROWS, { name: "SENS", environment: "production", inVault: false, onVercel: true }]);
    await userEvent.click(screen.getByRole("button", { name: "Pull" }));
    const dialog = screen.getByRole("dialog", { name: "Pull from Vercel" });
    expect(dialog).toHaveTextContent("preview · PLAIN");
    expect(dialog).toHaveTextContent("prod · SENS");
    expect(bridge.envPull).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Pull 1" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bridge.envPull).toHaveBeenCalledWith("/web");
    expect(notify).toHaveBeenCalledWith("Pulled PLAIN into the o/web vault");
  });

  it("offers Pull when every Vercel-only name is sensitive, saying why there's nothing to bring down", async () => {
    const { bridge } = setup(undefined, [{ name: "SENS", environment: "preview", inVault: false, onVercel: true }]);
    await userEvent.click(screen.getByRole("button", { name: "Pull" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Nothing Vercel will hand back.");
    expect(screen.queryByRole("button", { name: /^Pull \d/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pull" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bridge.envPull).not.toHaveBeenCalled();
  });

  it("pushes only what Vercel lacks", async () => {
    const { bridge, onDone } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Push 1" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bridge.envPushAll).toHaveBeenCalledWith("/web", [{ name: "A", environment: "production" }]);
  });

  it("shows the work, then toasts a failure without reloading", async () => {
    let fail: (e: Error) => void = () => undefined;
    const { notify, onDone } = setup({ envPushAll: vi.fn(() => new Promise<never>((_, reject) => (fail = reject))) });
    await userEvent.click(screen.getByRole("button", { name: "Push 1" }));
    expect(screen.getByRole("button", { name: "Pushing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
    fail(new Error("Touch ID failed"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Touch ID failed")));
    expect(onDone).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Push 1" })).toBeEnabled();
  });

  it("shows nothing in step, or on a main without them", () => {
    setup({}, [{ name: "K", environment: "preview", inVault: true, onVercel: true }]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    cleanup();
    setup({ envPull: undefined, envPushAll: undefined });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
