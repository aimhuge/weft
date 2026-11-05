// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./test-utils";
import VaultEventsList from "./VaultEventsList";
import { toVaultEvent } from "@/lib/vault-events";

// The 🔐 drawer's Event log tab (docs/architecture/teams-vault.md, "What the 🔐 drawer shows"):
// the last hundred rows of a vault's audit log, filtered to your own actions by default, with the
// live feed appending the rows that land.
describe("the drawer's event log", () => {
  it("says so when the tab has no shell to ask", () => {
    render(<VaultEventsList bridge={null} vaultId="github:me/app" vaultLabel="app" />);
    expect(screen.getByText(/desktop app/i)).toBeInTheDocument();
  });

  it("lists what the user did, newest first", async () => {
    const bridge = makeBridge([row({ id: "e1", action: "set", target_name: "STRIPE_KEY", target_environment: "production", actor_email: "sam@example.com" })]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText("sam")).toBeInTheDocument();
    expect(screen.getByText("changed STRIPE_KEY in production")).toBeInTheDocument();
  });

  it("shows who did it, not the value", async () => {
    const bridge = makeBridge([row({ id: "e1", action: "set", target_name: "STRIPE_KEY", target_environment: "production", actor_email: "sam@example.com" })]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText("changed STRIPE_KEY in production")).toBeInTheDocument();
    expect(screen.queryByText(/sk_live/)).not.toBeInTheDocument();
  });

  it("says so when nothing has happened yet", async () => {
    const bridge = makeBridge([]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText(/haven’t changed anything/i)).toBeInTheDocument();
  });

  it("asks for your own actions first, then everyone's", async () => {
    const bridge = makeBridge([]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    await waitFor(() => expect(bridge.events).toHaveBeenCalledWith("github:me/app", { scope: "mine" }));

    await userEvent.click(screen.getByRole("button", { name: "All members" }));
    await waitFor(() => expect(bridge.events).toHaveBeenCalledWith("github:me/app", { scope: "all" }));
    expect(screen.getByRole("button", { name: "All members" })).toHaveAttribute("aria-pressed", "true");
  });

  it("appends the rows that land while the tab is open", async () => {
    const bridge = makeBridge([]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    await screen.findByText(/haven’t changed anything/i);

    bridge.push({ vaultId: "github:me/app", rows: [row({ id: "e9", action: "remove", target_name: "OLD_KEY", actor_email: "sam@example.com" })] });
    expect(await screen.findByText("removed OLD_KEY in production")).toBeInTheDocument();
  });

  it("ignores the rows of another vault", async () => {
    const bridge = makeBridge([]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    await screen.findByText(/haven’t changed anything/i);

    bridge.push({ vaultId: "github:other/app", rows: [row({ id: "e9", action: "remove", target_name: "OLD_KEY" })] });
    expect(screen.queryByText("removed OLD_KEY in production")).not.toBeInTheDocument();
  });

  it("says so when the vault isn't shared yet", async () => {
    const bridge = makeBridge([], { shared: false });
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText(/isn't shared with a workspace yet/i)).toBeInTheDocument();
  });

  it("leaves a teammate's action out of your own actions", async () => {
    const bridge = makeBridge([
      row({ id: "e1", actor_user_id: "u1", actor_email: "sam@example.com" }),
      row({ id: "e2", actor_user_id: "u2", actor_email: "alex@example.com", action: "remove", target_name: "OLD_KEY" }),
    ]);
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText("changed STRIPE_KEY in production")).toBeInTheDocument();
    expect(screen.queryByText(/removed OLD_KEY/)).not.toBeInTheDocument();

    // The team's view has it.
    await userEvent.click(screen.getByRole("button", { name: "All members" }));
    await waitFor(() => expect(screen.getByText("removed OLD_KEY in production")).toBeInTheDocument());
  });

  it("shows the error the shell gave", async () => {
    const bridge = makeBridge([], { error: new Error("The vault only answers the board window.") });
    render(<VaultEventsList bridge={bridge} vaultId="github:me/app" vaultLabel="app" />);
    expect(await screen.findByText(/only answers the board window/i)).toBeInTheDocument();
  });
});

// A bridge that answers the tab, and remembers what it was asked for.
function makeBridge(rows: Record<string, unknown>[], opts: { shared?: boolean; error?: Error } = {}) {
  const listeners: ((payload: { vaultId: string; rows: Record<string, unknown>[] }) => void)[] = [];
  const bridge = {
    events: vi.fn(() => {
      if (opts.error) return Promise.reject(opts.error);
      return Promise.resolve({ events: rows.map(toVaultEvent), since: null, shared: opts.shared !== false, userId: "u1" });
    }),
    watchEvents: vi.fn(() => Promise.resolve()),
    unwatchEvents: vi.fn(() => Promise.resolve()),
    onEvents: vi.fn((callback: (payload: { vaultId: string; rows: Record<string, unknown>[] }) => void) => {
      listeners.push(callback);
      return () => {
        const at = listeners.indexOf(callback);
        if (at >= 0) listeners.splice(at, 1);
      };
    }),
    push(payload: { vaultId: string; rows: Record<string, unknown>[] }) {
      for (const listener of [...listeners]) listener(payload);
    },
  };
  return bridge;
}

// A row as the shell sends it: the seven named columns, and nothing else.
function row(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    action: "set",
    target_name: "STRIPE_KEY",
    target_environment: "production",
    actor_user_id: "u1",
    actor_email: "sam@example.com",
    created_at: "2026-10-27T10:00:00.000Z",
    ...over,
  };
}
