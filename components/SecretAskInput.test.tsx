// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultOverview } from "@/lib/vault-view";
import type { ThreadItem } from "@/lib/types";
import "./test-utils";
import SecretAskInput from "./SecretAskInput";
import { ThreadEntries, groupThread } from "./ThreadItems";

const ask = { folder: "/dev/web", name: "SUPABASE_SECRET_KEY", environment: "preview" as const };

function overview(missing: boolean): VaultOverview {
  return {
    unlocked: false,
    vaults: [{ id: "v", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], nudge: null, secrets: [{ name: ask.name, environment: "preview", missing, tail: "", updatedAt: "" }] }],
  };
}

function shell(missing = true) {
  const vault = { overview: vi.fn(() => Promise.resolve(overview(missing))), set: vi.fn(() => Promise.resolve({ saved: true })) };
  (window as unknown as { weft: unknown }).weft = { vault };
  return vault;
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("SecretAskInput", () => {
  it("takes the value in the thread, puts it in the vault, and tells the thread", async () => {
    const vault = shell();
    const onAdded = vi.fn();
    render(<SecretAskInput ask={ask} onAdded={onAdded} />);
    const value = await screen.findByLabelText("Value");
    expect(value).toHaveFocus();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add to vault" })).toBeDisabled();
    await userEvent.type(value, "sb_secret_x");
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to 2 environments" }));
    expect(vault.set).toHaveBeenCalledWith("/dev/web", ask.name, "preview", "sb_secret_x");
    expect(vault.set).toHaveBeenCalledWith("/dev/web", ask.name, "production", "sb_secret_x");
    expect(onAdded).toHaveBeenCalledWith("I added SUPABASE_SECRET_KEY (preview, production) to the 🔐 vault.");
    expect(onAdded.mock.calls[0]?.[0]).not.toContain("sb_secret_x");
    expect(screen.getByText(/is in the 🔐 vault/)).toBeInTheDocument();
  });

  it("shows a ✓ when the vault already has it, and the vault's error when a save fails", async () => {
    shell(false);
    const { unmount } = render(<SecretAskInput ask={ask} />);
    expect(await screen.findByText(/is in the 🔐 vault/)).toBeInTheDocument();
    unmount();

    const vault = shell();
    vault.set.mockRejectedValueOnce(new Error("Vault is locked"));
    render(<SecretAskInput ask={ask} />);
    await userEvent.type(await screen.findByLabelText("Value"), "x{Enter}");
    expect(await screen.findByText("Vault is locked")).toBeInTheDocument();
  });

  it("points at the rail outside the desktop app", () => {
    render(<SecretAskInput ask={ask} />);
    expect(screen.getByText(/add it with 🔐 on the board's left rail/)).toBeInTheDocument();
  });

  it("stands on its own in a thread instead of folding into the tool run", async () => {
    shell();
    const items: ThreadItem[] = [
      { kind: "tool", id: "1", name: "Bash", summary: "ls", at: 0 },
      { kind: "tool", id: "2", name: "mcp__secrets__ask_add", summary: "", at: 0, ask },
      { kind: "tool", id: "3", name: "Bash", summary: "pwd", at: 0 },
    ];
    const entries = groupThread(items);
    expect(entries.map((e) => e.kind)).toEqual(["tools", "item", "tools"]);
    const onSend = vi.fn(() => Promise.resolve());
    render(<ThreadEntries entries={entries} live={false} streaming="" onSend={onSend} cardId="x" />);
    await waitFor(() => expect(screen.getByRole("form", { name: "Add SUPABASE_SECRET_KEY to the vault" })).toBeInTheDocument());
  });

  it("keeps every ask in a thread open and tells the thread once, when the last is in", async () => {
    const vault = shell();
    const two = { ...ask, name: "R2_SECRET_ACCESS_KEY" };
    const items: ThreadItem[] = [
      { kind: "tool", id: "1", name: "mcp__secrets__ask_add", summary: "", at: 0, ask },
      { kind: "tool", id: "2", name: "mcp__secrets__ask_add", summary: "", at: 0, ask: two },
      { kind: "tool", id: "3", name: "mcp__secrets__ask_add", summary: "", at: 0, ask },
    ];
    const onSend = vi.fn(() => Promise.resolve());
    render(<ThreadEntries entries={groupThread(items)} live={false} streaming="" onSend={onSend} cardId="x" />);
    await waitFor(() => expect(screen.getAllByLabelText("Value")).toHaveLength(3));
    const [first, second] = screen.getAllByLabelText("Value");
    await userEvent.type(first!, "a{Enter}");
    // The repeated ask for the same key folds with it; the other stays open and the thread hasn't heard.
    await waitFor(() => expect(screen.getAllByText(/is in the 🔐 vault/)).toHaveLength(2));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText(/1 added; Claude hears once the rest are in/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Value"), "b");
    await userEvent.click(screen.getByRole("button", { name: "Add to vault" }));
    expect(vault.set).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("I added SUPABASE_SECRET_KEY (preview), R2_SECRET_ACCESS_KEY (preview) to the 🔐 vault.");
    expect(second).not.toBeInTheDocument();
  });

  it("adds every filled ask at once, or tells the thread early", async () => {
    const vault = shell();
    const asks = ["A", "B", "C"].map((name) => ({ ...ask, name }));
    const items: ThreadItem[] = asks.map((a, i) => ({ kind: "tool", id: String(i), name: "mcp__secrets__ask_add", summary: "", at: 0, ask: a }));
    const onSend = vi.fn(() => Promise.resolve());
    render(<ThreadEntries entries={groupThread(items)} live={false} streaming="" onSend={onSend} cardId="x" />);
    await waitFor(() => expect(screen.getAllByLabelText("Value")).toHaveLength(3));
    const [a, b] = screen.getAllByLabelText("Value");
    await userEvent.type(a!, "1");
    await userEvent.type(b!, "2");
    await userEvent.click(screen.getAllByRole("button", { name: "Add 2 keys to vault" })[0]!);
    expect(vault.set).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Tell Claude now" }));
    expect(onSend).toHaveBeenCalledWith("I added A (preview), B (preview) to the 🔐 vault.");
    expect(screen.getByText("Goes straight into the vault; Claude never sees it.")).toBeInTheDocument();
  });
});
