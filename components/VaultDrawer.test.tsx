// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSummary } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The drawer's "Show recovery key" item opens the vault's recovery page with
// next/navigation's useRouter().push — the app router isn't mounted in a test, so the
// router is stubbed.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const vault = (id: string, label: string, folder: string, over: Partial<VaultSummary> = {}): VaultSummary => ({
  id,
  label,
  folder,
  folders: [folder],
  secrets: [],
  nudge: null,
  ...over,
});

const overview: VaultOverview = {
  unlocked: false,
  vaults: [
    vault("github:o/web", "o/web", "/dev/web", { secrets: [{ name: "API_KEY", environment: "development", missing: false, tail: "1111", updatedAt: "" }] }),
    vault("folder:/dev/notes", "notes", "/dev/notes"),
  ],
};

function bridge() {
  return {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(() => Promise.resolve({ saved: true as const })),
    addBlank: vi.fn(() => Promise.resolve({ label: "notes", filled: [] })),
    copyTo: vi.fn(() => Promise.resolve({ copied: true as const, label: "notes", replaced: false })),
    remove: vi.fn(),
    lock: vi.fn(() => Promise.resolve({ unlocked: false as const })),
  };
}

function setup(project: string | null, popupMenu?: (items: unknown) => Promise<unknown>, ov = overview) {
  if (popupMenu) (window as unknown as { weft: unknown }).weft = { popupMenu };
  const b = bridge();
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const view = render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={ov} error={null} reload={reload} project={project} notify={notify} />);
  return { b, reload, notify, view };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("VaultDrawer", () => {
  it("marks a revealed value data-secret and reveal and copy data-secret-action, for the board view", async () => {
    const { b } = setup("/dev/web");
    b.reveal.mockResolvedValue({ value: "sk-live-1111" });
    expect(screen.getByRole("button", { name: "Reveal API_KEY" })).toHaveAttribute("data-secret-action", "eye");
    expect(screen.getByRole("button", { name: "Copy API_KEY" })).toHaveAttribute("data-secret-action", "copy");
    expect(screen.getByRole("button", { name: "Change API_KEY" })).not.toHaveAttribute("data-secret-action");
    await userEvent.click(screen.getByRole("button", { name: "Reveal API_KEY" }));
    expect(await screen.findByText("sk-live-1111")).toHaveAttribute("data-secret");
  });

  it("follows the top bar's project, lets you pick another, and follows the top bar again when it changes", async () => {
    const { b, reload, notify, view } = setup("/dev/web");
    const filter = screen.getByLabelText("Filter by project");
    expect(filter).toHaveValue("/dev/web");
    expect(screen.getByRole("heading", { name: "o/web" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "notes" })).not.toBeInTheDocument();

    await userEvent.selectOptions(filter, "");
    expect(screen.getByRole("heading", { name: "notes" })).toBeInTheDocument();
    view.rerender(<VaultDrawer bridge={b} overview={overview} error={null} reload={reload} project="/dev/notes" notify={notify} />);
    expect(screen.getByLabelText("Filter by project")).toHaveValue("/dev/notes");
    expect(screen.queryByRole("heading", { name: "o/web" })).not.toBeInTheDocument();
  });

  it("adds a secret to a project with no .env file", async () => {
    const { b, reload } = setup("/dev/notes");
    expect(screen.getByText(/No secrets yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    await userEvent.type(screen.getByLabelText("Name"), "1BAD");
    expect(screen.getByText(/not starting with a digit/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "OPENAI_KEY");
    // No value typed: with the shell's addBlank, the button is "Add to N environments" but the action
    // is still per-env, so we go through addBlank to put the name in without a value.
    const env = (name: string) => screen.getByRole("button", { name });
    expect(env("Development")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(env("Production"));
    await userEvent.type(screen.getByLabelText("Value"), "sk-123");
    const add = screen.getByRole("button", { name: "Add to 2 environments" });
    expect(screen.getByLabelText("Value")).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show value" }));
    expect(screen.getByLabelText("Value")).toHaveAttribute("type", "text");
    await userEvent.click(add);
    expect(b.set).toHaveBeenCalledWith("/dev/notes", "OPENAI_KEY", "development", "sk-123");
    expect(b.set).toHaveBeenCalledWith("/dev/notes", "OPENAI_KEY", "production", "sk-123");
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
  });

  it("saves an empty value as a blank when the shell supports it, and the button labels it as such", async () => {
    const { b, reload } = setup("/dev/notes");
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    // With no value, the button is "Add blank" instead of "Add to vault".
    const blank = screen.getByRole("button", { name: "Add blank" });
    expect(blank).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "STRIPE_WEBHOOK_SECRET");
    expect(blank).not.toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    expect(screen.getByRole("button", { name: "Add 2 blanks" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add 2 blanks" }));
    expect(b.addBlank).toHaveBeenCalledWith("/dev/notes", "STRIPE_WEBHOOK_SECRET", "development");
    expect(b.addBlank).toHaveBeenCalledWith("/dev/notes", "STRIPE_WEBHOOK_SECRET", "production");
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(b.set).not.toHaveBeenCalled();
  });

  it("shows a Fill in button on a blank row, with its hint in the tooltip and under the name", () => {
    const blankOverview: VaultOverview = {
      unlocked: false,
      vaults: [
        vault("github:o/web", "o/web", "/dev/web", {
          secrets: [
            { name: "STRIPE_SECRET_KEY", environment: "development", missing: true, tail: "", updatedAt: "", source: "a thread", hint: "Stripe dashboard → Developers → API keys" },
            { name: "GITHUB_TOKEN", environment: "development", missing: true, tail: "", updatedAt: "" },
          ],
        }),
      ],
    };
    const { b } = setup("/dev/web", undefined, blankOverview);
    Object.assign(b, { addBlank: vi.fn() });
    const stripe = screen.getByRole("button", { name: "Fill in STRIPE_SECRET_KEY" });
    expect(stripe).toHaveAttribute("title", "Fill in STRIPE_SECRET_KEY: Stripe dashboard → Developers → API keys");
    expect(screen.getByText("Stripe dashboard → Developers → API keys")).toBeInTheDocument();
    const github = screen.getByRole("button", { name: "Fill in GITHUB_TOKEN" });
    expect(github).toHaveAttribute("title", "Fill in GITHUB_TOKEN");
    expect(screen.getByText("STRIPE_SECRET_KEY").title).toContain("added by a thread");
  });
  it("adds one secret to several environments at once, and needs at least one", async () => {
    const { b } = setup("/dev/notes");
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    await userEvent.type(screen.getByLabelText("Name"), "GITHUB_CLIENT_SECRET");
    await userEvent.type(screen.getByLabelText("Value"), "gh-1");
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    const add = screen.getByRole("button", { name: "Add to 3 environments" });
    for (const name of ["Development", "Preview", "Production"]) await userEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Add to vault" })).toBeDisabled();
    for (const name of ["Production", "Development"]) await userEvent.click(screen.getByRole("button", { name }));
    await userEvent.click(screen.getByRole("button", { name: "Add to 2 environments" }));
    expect(add).not.toBeInTheDocument();
    // In the drawer's order, not the order they were ticked.
    expect(b.set.mock.calls).toEqual([
      ["/dev/notes", "GITHUB_CLIENT_SECRET", "development", "gh-1"],
      ["/dev/notes", "GITHUB_CLIENT_SECRET", "production", "gh-1"],
    ]);
  });

  it("removes a secret from its trash button only once the red countdown runs out", async () => {
    const { b } = setup("/dev/web");
    vi.useFakeTimers();
    const confirm = () => screen.getByRole("button", { name: "Confirm removing API_KEY" });
    // A double-click on 🗑 lands its second click on the countdown, which ignores it.
    fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
    fireEvent.click(confirm());
    expect(confirm()).toHaveTextContent("Confirm in 3");
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    void act(() => vi.advanceTimersByTime(1100));
    expect(confirm()).toHaveTextContent("Confirm in 2");
    fireEvent.click(confirm());
    expect(b.remove).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByText("API_KEY").closest(".group")!);
    expect(screen.queryByRole("button", { name: "Confirm removing API_KEY" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
    void act(() => vi.advanceTimersByTime(3000));
    expect(confirm()).toHaveTextContent("Remove");
    expect(confirm()).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(confirm());
    vi.useRealTimers();
    await waitFor(() => expect(b.remove).toHaveBeenCalledWith("github:o/web", "API_KEY", "development"));
  });

  it("removes at once on a ⌘- or Ctrl-click during the countdown", async () => {
    const { b } = setup("/dev/web");
    fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
    const confirm = screen.getByRole("button", { name: "Confirm removing API_KEY" });
    expect(confirm.title).toMatch(/-click to skip the wait/);
    fireEvent.click(confirm, { metaKey: true });
    await waitFor(() => expect(b.remove).toHaveBeenCalledWith("github:o/web", "API_KEY", "development"));
    fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing API_KEY" }), { ctrlKey: true });
    await waitFor(() => expect(b.remove).toHaveBeenCalledTimes(2));
  });

  it("paints 🗑 red while ⌘ or Ctrl is held, and a held click removes with no countdown", async () => {
    const { b } = setup("/dev/web");
    const trash = screen.getByRole("button", { name: "Remove API_KEY" });
    expect(trash).not.toHaveClass("text-danger");
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(trash).toHaveClass("text-danger");
    expect(trash).toHaveAttribute("title", "Remove now");
    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    expect(trash).not.toHaveClass("text-danger");
    fireEvent.click(trash, { ctrlKey: true });
    expect(screen.queryByRole("button", { name: "Confirm removing API_KEY" })).not.toBeInTheDocument();
    await waitFor(() => expect(b.remove).toHaveBeenCalledWith("github:o/web", "API_KEY", "development"));
  });

  it("asks which environments when 🗑 or the menu removes a name that's in several", async () => {
    const secret = (environment: "development" | "production") => ({ name: "API_KEY", environment, missing: false, tail: "1111", updatedAt: "" });
    const spread: VaultOverview = { unlocked: false, vaults: [vault("github:o/web", "o/web", "/dev/web", { secrets: [secret("development"), secret("production")] })] };
    const popupMenu = vi.fn(() => Promise.resolve("remove"));
    const { b } = setup("/dev/web", popupMenu, spread);
    const [devTrash] = screen.getAllByRole("button", { name: "Remove API_KEY" });
    // Even with ⌘ held, a name in several environments asks first.
    fireEvent.click(devTrash!, { metaKey: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("It's in 2 environments. Remove it from:");
    expect(screen.getByRole("button", { name: "Development" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Remove from all 2" }));
    // Changing the picks calls the countdown off.
    fireEvent.click(screen.getByRole("button", { name: "Production" }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Production" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from all 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing API_KEY" }));
    expect(b.remove).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing API_KEY" }));
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(b.remove.mock.calls).toEqual([
      ["github:o/web", "API_KEY", "development"],
      ["github:o/web", "API_KEY", "production"],
    ]);

    // The right-click menu's Remove from Vault… opens the same dialog, on the row you clicked.
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getAllByText("API_KEY")[1]! });
    await waitFor(() => expect(screen.getByRole("button", { name: "Production" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Development" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before removing a name in one environment from the menu", async () => {
    setup("/dev/web", () => Promise.resolve("remove"));
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("API_KEY") });
    expect(await screen.findByRole("dialog")).toHaveTextContent("Remove it from:");
    await userEvent.click(screen.getByRole("button", { name: "Development" }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("changes a value in place, and Escape cancels", async () => {
    const { b } = setup("/dev/web");
    await userEvent.click(screen.getByRole("button", { name: "Change API_KEY" }));
    expect(screen.getByLabelText("Name")).toBeDisabled();
    // Its environments stay open to change; only its own is ticked.
    expect(screen.getByRole("button", { name: "Production" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Development" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change API_KEY" }));
    await userEvent.type(screen.getByLabelText("Value"), "new-value{Enter}");
    expect(b.set).toHaveBeenCalledWith("/dev/web", "API_KEY", "development", "new-value");
    expect(b.remove).not.toHaveBeenCalled();
  });

  it("copies a secret to another project from its right-click menu", async () => {
    const popupMenu = vi.fn((items: unknown) => {
      expect(items).toContainEqual({ id: "copy-to:/dev/notes", label: "Copy to notes" });
      return Promise.resolve("copy-to:/dev/notes");
    });
    const { b, notify } = setup(null, popupMenu);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("API_KEY") });
    await waitFor(() => expect(b.copyTo).toHaveBeenCalledWith("github:o/web", "API_KEY", "development", "/dev/notes"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Copied API_KEY in notes"));
  });

  it("offers to let Weft write .env.local after an import, and skips it when unticked", async () => {
    const local = { file: ".env.local", environment: "development" as const, namesOnly: false, tracked: false, vercel: false };
    const row = { file: ".env.local", name: "DB", environment: "development" as const, status: "new" as const, tail: "", public: false, ticked: true, skipped: false };
    const scan = { id: "github:o/web", label: "o/web", files: [local], rows: [row] };
    const { b, notify } = setup("/dev/web");
    const writeBack = vi.fn(() => Promise.resolve({ written: true as const, file: ".env.local", gitignoreAdded: false }));
    Object.assign(b, { writeBack });
    b.scan.mockResolvedValue(scan);
    b.import.mockResolvedValue({ imported: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    const manage = await screen.findByLabelText("Then let Weft write .env.local from the vault");
    expect(manage).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(writeBack).toHaveBeenCalledWith("/dev/web"));
    expect(notify).toHaveBeenCalledWith("Weft now writes .env.local from the vault.");

    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    await userEvent.click(await screen.findByLabelText("Then let Weft write .env.local from the vault"));
    await userEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(b.import).toHaveBeenCalledTimes(2));
    expect(writeBack).toHaveBeenCalledTimes(1);
  });

  it("doesn't offer it for a managed .env.local", async () => {
    const managed: VaultOverview = { unlocked: false, vaults: [vault("github:o/web", "o/web", "/dev/web", { managed: true })] };
    const { b } = setup("/dev/web", undefined, managed);
    Object.assign(b, { writeBack: vi.fn() });
    b.scan.mockResolvedValue({ id: "github:o/web", label: "o/web", files: [{ file: ".env.local", environment: "development", namesOnly: false, tracked: false, vercel: false }], rows: [] });
    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    await screen.findByText("Import into o/web");
    expect(screen.queryByLabelText("Then let Weft write .env.local from the vault")).not.toBeInTheDocument();
  });
});

