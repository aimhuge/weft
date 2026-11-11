// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceBridge, DeviceStanding } from "@/lib/vault-view";
import { DeviceStandingLine, ThisMacStanding } from "./DeviceStanding";
import { JoinHint } from "./VaultShared";

vi.mock("@/lib/use-account", () => ({ ACCOUNT_EVENT: "weft:account", useAccount: () => ({ waiting: null, signIn: vi.fn() }) }));

afterEach(() => {
  cleanup();
  delete (window as { weft?: unknown }).weft;
});

const bridge = (devices: DeviceBridge) => devices;

describe("DeviceStandingLine", () => {
  it("re-adds a removed Mac, then loads again", async () => {
    const readd = vi.fn(() => Promise.resolve({ resealed: 2 }));
    const onDone = vi.fn();
    render(<DeviceStandingLine state="revoked" devices={bridge({ readd })} onDone={onDone} notify={vi.fn()} />);
    expect(screen.getByText(/This Mac was removed from your account/)).toBeTruthy();
    fireEvent.click(screen.getByText("Re-add it"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(readd).toHaveBeenCalled();
  });

  it("does nothing more when Touch ID is turned down", async () => {
    const readd = vi.fn(() => Promise.resolve({ denied: true }));
    const onDone = vi.fn();
    render(<DeviceStandingLine state="revoked" devices={bridge({ readd })} onDone={onDone} notify={vi.fn()} />);
    fireEvent.click(screen.getByText("Re-add it"));
    await waitFor(() => expect(readd).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("tries registering again, and says why when it fails", async () => {
    const register = vi.fn(() => Promise.reject(new Error("permission denied")));
    const notify = vi.fn();
    render(<DeviceStandingLine state="unregistered" error="This device could not be registered: offline" devices={bridge({ register, readd: vi.fn() })} onDone={vi.fn()} notify={notify} />);
    expect(screen.getByText(/could not be registered: offline/)).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("permission denied")));
  });

  it("offers no button in a shell that can't re-add", () => {
    render(<DeviceStandingLine state="revoked" devices={null} onDone={vi.fn()} notify={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is what the vault's JoinHint shows for a removed Mac", () => {
    (window as { weft?: unknown }).weft = { vault: { devices: { readd: vi.fn() } } };
    render(<JoinHint hint="revoked" onDone={vi.fn()} />);
    expect(screen.getByText("Re-add it")).toBeTruthy();
  });
});

describe("ThisMacStanding", () => {
  const withStanding = (standing: DeviceStanding) => {
    (window as { weft?: unknown }).weft = { vault: { devices: { standing: vi.fn(() => Promise.resolve(standing)), readd: vi.fn(), register: vi.fn() } } };
  };

  it("says when this Mac was removed", async () => {
    withStanding({ state: "revoked" });
    render(<ThisMacStanding onDone={vi.fn()} notify={vi.fn()} />);
    expect(await screen.findByText("Re-add it")).toBeTruthy();
  });

  it("says nothing for a registered Mac", async () => {
    withStanding({ state: "registered" });
    const { container } = render(<ThisMacStanding onDone={vi.fn()} notify={vi.fn()} />);
    await waitFor(() => expect((window as { weft?: { vault: { devices: { standing: () => unknown } } } }).weft!.vault.devices.standing).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
