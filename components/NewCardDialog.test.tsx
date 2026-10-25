// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import type { Card, RestartStatus } from "@/lib/types";
import { isMac } from "@/lib/hotkeys";
import { formatAt } from "@/lib/schedule";
import { markIntroSeen } from "@/lib/feature-intros";
import { makeCard } from "./test-utils";
import NewCardDialog from "./NewCardDialog";

const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));
// The gate reads the plan log off the server; the tests say what it answers.
const gate = vi.hoisted(() => ({ at: undefined as number | undefined }));
vi.mock("@/lib/use-start-gate", () => ({ useStartGate: () => gate.at ? { at: gate.at, kind: "five_hour", subject: "claude" } : undefined }));
vi.mock("./Composer", () => import("./composer-mock"));
// The real picker lists repos from the server and GitHub; this one just shows the folder and offers another.
vi.mock("./RepoPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (folder: string) => void }) => (
    <div>
      <span>Folder: {value}</span>
      <button type="button" onClick={() => onChange("/repo/api")}>
        Pick /repo/api
      </button>
    </div>
  ),
}));

function setup(props: { cards?: Card[]; defaultCwd?: string; restart?: RestartStatus } = {}) {
  const onCreate = vi.fn<(input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>>(() => Promise.resolve());
  const onClose = vi.fn();
  render(<NewCardDialog home="/home" defaultCwd="/repo/web" onCreate={onCreate} onClose={onClose} {...props} />);
  return { onCreate, onClose, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  gate.at = undefined;
});

describe("NewCardDialog", () => {
  it("says Restart requested in its header while a restart waits", () => {
    setup();
    expect(screen.queryByText("Restart requested")).toBeNull();
    cleanup();
    setup({ restart: { armed: true, then: "relaunch", waiting: [] } });
    expect(screen.getByText("Restart requested")).toBeInTheDocument();
  });

  it("needs a prompt before it starts", async () => {
    const { onCreate } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Write a prompt first.")).toBeInTheDocument();
  });

  it("Start now creates a started card in the chosen folder and closes", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "Add dark mode");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Add dark mode", cwd: "/repo/web", backend: "claude", start: true }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("says Starting… while the server makes the thread, with both buttons disabled", async () => {
    const { onCreate, box } = setup();
    let finish = () => {};
    onCreate.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await userEvent.type(box, "Slow start");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to backlog" })).toBeDisabled();
    await act(() => { finish(); return Promise.resolve(); });
  });

  it("Add to backlog creates the card without starting it", async () => {
    const { onCreate, box } = setup();
    await userEvent.type(box, "Later idea");
    await userEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Later idea", cwd: "/repo/web", start: false }));
  });

  it("⌘B adds it to the backlog instead of bolding", async () => {
    const { onCreate, box } = setup();
    await userEvent.type(box, "Backlog by key");
    fireEvent.keyDown(box, { key: "b", metaKey: isMac(), ctrlKey: !isMac() });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Backlog by key", start: false }));
  });

  it("picking another folder uses it, warms a CLI there and remembers it", async () => {
    const { onCreate, box } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pick /repo/api" }));
    expect(screen.getByText("Folder: /repo/api")).toBeInTheDocument();
    expect(api.warm).toHaveBeenCalledWith({ cwd: "/repo/api", backend: "claude" });
    await userEvent.type(box, "Fix the API");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo/api" }));
    await waitFor(() => expect(localStorage.getItem("threadboard.cwd")).toBe("/repo/api"));
  });

  // The dialog normalizes the picked effort through effortFor: puku drops xhigh, keeps low/medium/high/max.
// (effortFor is unit-tested in lib/new-thread.test.ts; this just pins the wiring through the dialog.)
  it("picking a CLI's default in the model picker passes the effort through effortFor, so puku keeps high", async () => {
    const { onCreate, box } = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Model" }), "cli:puku");
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    // The dialog's default effort is "high" (lastEffort), which puku accepts.
    expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ backend: "puku", effort: "high" }));
  });

  it("the model picker is the CLI picker: a model moves the thread to the CLI serving it", async () => {
    const { onCreate, box } = setup();
    const picker = screen.getByRole("combobox", { name: "Model" });
    expect(screen.queryByRole("group", { name: "CLI" })).toBeNull();
    await userEvent.selectOptions(picker, "opus-4.8");
    await userEvent.selectOptions(picker, "cli:codex");
    expect((picker as HTMLSelectElement).value).toBe("cli:codex");
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ backend: "codex" }));
  });

  it("starts in Settings' default permission mode", async () => {
    const { onCreate, box } = setup();
    await waitFor(() => expect(api.settings).toHaveBeenCalled());
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: "default" }));
  });

  it("shows a failed create and stays open", async () => {
    const { onCreate, onClose, box } = setup();
    onCreate.mockRejectedValueOnce(new Error("Folder not found"));
    await userEvent.type(box, "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(await screen.findByText("Folder not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("⌃↵ starts the thread and stays open, emptied, for the next one", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "First task");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "First task", start: true }), { stay: true });
    expect(await screen.findByText("Started “First task” · write the next one")).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(box, "S");
    expect(screen.queryByText(/Started “/)).not.toBeInTheDocument();
  });

  it("a started thread clears the draft", async () => {
    const { box } = setup();
    await userEvent.type(box, "Ship it");
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBe("Ship it"));
    await userEvent.click(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBeNull());
  });

  it("⌃↵ starts the thread and stays open, emptied, for the next one", async () => {
    const { onCreate, onClose, box } = setup();
    await userEvent.type(box, "First task");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "First task", start: true }), { stay: true });
    expect(await screen.findByText("Started “First task” · write the next one")).toBeInTheDocument();
    expect(box).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(box, "S");
    expect(screen.queryByText(/Started “/)).not.toBeInTheDocument();
  });

  it("the Start button names what ⌘↵ and ⌃↵ do while they're held", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    setup();
    const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", init)));
    key({ key: "Meta", metaKey: true });
    expect(screen.getByRole("button", { name: "Start & close" })).toBeInTheDocument();
    key({ key: "Control", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Start, keep open" })).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(screen.getByRole("button", { name: "Start now" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("keeps the prompt as a draft for next time", async () => {
    const { box } = setup();
    await userEvent.type(box, "Unfinished");
    await waitFor(() => expect(localStorage.getItem("weft.newThreadDraft")).toBe("Unfinished"));
  });

  it("closes on Escape and on the close button", async () => {
    // The intro has played before, so it isn't up: Escape belongs to the dialog (lib/use-feature-intro.ts).
    markIntroSeen("newthread");
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("lets the first Escape shrink the intro that opened over it, and the next close the dialog", async () => {
    // The first time the dialog opens, the intro plays big over it (lib/use-feature-intro.ts). Escape shrinks
    // that modal; the dialog under it stays open, and the next Escape closes it.
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe("a model at its limit", () => {
    // A thread started on a spent model fails on its first turn, so the button waits for the reset
    // instead (lib/start-gate.ts decides on the server; this names it).
    const resetAt = Date.now() + 4 * 60 * 60 * 1000;
    // formatAt() names the time the way the footer does (lib/schedule.ts) — and it prefixes the
    // weekday when the reset is not today, so the label moves with the clock. Build the same string
    // here instead of hand-rolling the time: four hours from now is often tomorrow.
    const when = formatAt(resetAt);

    it("offers Start at the reset instead of Start now", () => {
      gate.at = resetAt;
      setup();
      expect(screen.getByRole("button", { name: new RegExp(`Start at ${when}`) })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start now" })).not.toBeInTheDocument();
    });

    it("says which limit is used up and when the thread starts", () => {
      gate.at = resetAt;
      setup();
      expect(screen.getByText(/5-hour limit used up/)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`starts at ${when}`))).toBeInTheDocument();
    });

    it("still starts the thread when the user asks", async () => {
      gate.at = resetAt;
      const { onCreate, box } = setup();
      await userEvent.type(box, "Add dark mode");
      await userEvent.click(screen.getByRole("button", { name: new RegExp(`Start at ${when}`) }));
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Add dark mode", start: true }));
    });

    it("says Start now when nothing is spent", () => {
      setup();
      expect(screen.getByRole("button", { name: "Start now" })).toBeInTheDocument();
    });
  });

  describe("busy-folder hint", () => {
    const busy = makeCard({ id: "c2", title: "Refactor auth", cwd: "/repo/web", column: "running" });

    it("warns when a card is busy in the chosen folder", () => {
      setup({ cards: [busy] });
      expect(screen.getByText("Also running here: Refactor auth")).toBeInTheDocument();
    });

    it("doesn't warn for idle cards or other folders, and follows the folder you pick", async () => {
      setup({ cards: [makeCard({ id: "c3", cwd: "/repo/web", column: "review" }), { ...busy, cwd: "/repo/api" }] });
      expect(screen.queryByText(/Also running here/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Pick /repo/api" }));
      expect(screen.getByText("Also running here: Refactor auth")).toBeInTheDocument();
    });
  });
});
