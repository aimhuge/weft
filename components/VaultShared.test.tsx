// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultSummary } from "@/lib/vault-view";
import { DeviceRequests, JoinOffer, SharedBadge } from "./VaultShared";

afterEach(cleanup);

const join = { vaultId: "v1", orgId: "o1", repo: "a/b", state: "none" as const, fingerprint: "a1b2" };
const bridge = (extra: Partial<VaultBridge>) => extra as VaultBridge;

describe("JoinOffer", () => {
  it("asks to join, and reloads the drawer", async () => {
    const requestJoin = vi.fn(() => Promise.resolve({ pendingId: "p" }));
    const onDone = vi.fn();
    render(<JoinOffer folder="/repo" join={join} bridge={bridge({ requestJoin, join: vi.fn() })} onDone={onDone} notify={vi.fn()} />);
    fireEvent.click(screen.getByText("Ask to join"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(requestJoin).toHaveBeenCalledWith("v1");
  });

  it("shows the fingerprint while it waits, with nothing to press", () => {
    render(<JoinOffer folder="/repo" join={{ ...join, state: "asked" }} bridge={bridge({ requestJoin: vi.fn(), join: vi.fn() })} onDone={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("a1b2")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the vault once approved, and shows a failure as a toast", async () => {
    const open = vi.fn(() => Promise.reject(new Error("no")));
    const notify = vi.fn();
    const details = { ...join, state: "granted" as const };
    render(<JoinOffer folder="/repo" join={details} bridge={bridge({ requestJoin: vi.fn(), join: open })} onDone={vi.fn()} notify={notify} />);
    fireEvent.click(screen.getByText("Open shared vault"));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith("/repo", details);
  });

  it("offers nothing in an older shell", () => {
    const { container } = render(<JoinOffer folder="/repo" join={join} bridge={null} onDone={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

describe("DeviceRequests", () => {
  const request = { id: "p1", person: "Sam", deviceName: "Sam's Mac", fingerprint: "c3d4" };

  it("says what approving gives, and approves or declines by request", async () => {
    const deviceGrant = vi.fn(() => Promise.resolve({}));
    const deviceDecline = vi.fn(() => Promise.resolve({ declined: true }));
    const onDone = vi.fn();
    render(<DeviceRequests requests={[request]} bridge={bridge({ deviceGrant, deviceDecline })} onDone={onDone} notify={vi.fn()} />);
    expect(screen.getByText(/every key in this vault, production too/)).toBeTruthy();
    expect(screen.getByText("c3d4")).toBeTruthy();
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(deviceGrant).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() => expect(deviceDecline).toHaveBeenCalledWith("p1"));
  });
});

describe("SharedBadge", () => {
  it("says who the vault is shared with", () => {
    const shared = { org: { id: "o1", slug: "acme", name: "Acme" }, vaultId: "v1", keyVersion: 2, serverVersion: 1, recoveryShownAt: null };
    const vault = { id: "github:a/b", label: "a/b", folder: "/repo", folders: ["/repo"], secrets: [], nudge: null, shared } as VaultSummary;
    render(<SharedBadge vault={vault} />);
    expect(screen.getByText("Shared with Acme")).toBeTruthy();
  });
});
