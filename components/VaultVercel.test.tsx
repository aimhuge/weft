// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VercelBridge, VercelEnvStatus } from "@/lib/vercel-view";
import "./test-utils";
import VaultVercel from "./VaultVercel";

const STATUS: VercelEnvStatus = {
  label: "aimhuge/weft",
  project: "weft",
  rows: [
    { name: "APP_SECRETS_KEY", environment: "development", inVault: true, onVercel: false },
    { name: "GITHUB_CLIENT_ID", environment: "development", inVault: true, onVercel: true },
  ],
};

function setup(over: Partial<VercelBridge> = {}) {
  const bridge = {
    envStatus: vi.fn(() => Promise.resolve(STATUS)),
    envPushAll: vi.fn(() => Promise.resolve({ label: "aimhuge/weft", project: "weft", sent: [{ name: "APP_SECRETS_KEY", environment: "development" }] })),
    ...over,
  };
  (window as unknown as { weft: unknown }).weft = { vercel: bridge };
  const notify = vi.fn();
  const view = render(<VaultVercel folder="/dev/weft" changed="a" notify={notify} />);
  return { bridge, notify, view };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("VaultVercel", () => {
  it("names the linked project, says what drifted and pushes just that, then reloads", async () => {
    const { bridge, notify } = setup();
    expect(await screen.findByText("weft")).toBeInTheDocument();
    expect(screen.getByText(/1 missing on development: push\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Push 1" }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(bridge.envPushAll).toHaveBeenCalledWith("/dev/weft", [{ name: "APP_SECRETS_KEY", environment: "development" }]);
    expect(bridge.envStatus).toHaveBeenCalledTimes(2);
  });

  it("has no button when everything is on Vercel", async () => {
    setup({ envStatus: vi.fn(() => Promise.resolve({ ...STATUS, rows: [STATUS.rows[1]!] })) });
    expect(await screen.findByText(/All 1 vault secret is on Vercel/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws nothing for an unlinked folder", async () => {
    const { bridge, view } = setup({ envStatus: vi.fn(() => Promise.reject(new Error("weft isn't linked to a Vercel project yet."))) });
    await waitFor(() => expect(bridge.envStatus).toHaveBeenCalled());
    expect(view.container).toBeEmptyDOMElement();
  });

  it("reloads when the vault changes and toasts a failed push", async () => {
    const { bridge, notify, view } = setup({ envPushAll: vi.fn(() => Promise.reject(new Error("Touch ID failed"))) });
    await screen.findByText("weft");
    view.rerender(<VaultVercel folder="/dev/weft" changed="b" notify={notify} />);
    await waitFor(() => expect(bridge.envStatus).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Push 1" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("Touch ID failed")));
  });
});
