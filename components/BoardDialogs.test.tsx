// @vitest-environment jsdom
//
// BoardDialogs is only a stage: Board used to write the nine dialogs as one conditional block, and
// this says which panel each prop opens, that the right handler closes it, and that a closed panel
// draws nothing at all. Every panel loads through guarded(), so each one is awaited with findBy*.
// ModifierHint and FileDrop render nothing until they're used, so they're covered by their own tests.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import BoardDialogs, { type BoardDialogsProps } from "./BoardDialogs";

// jsdom has no scrollIntoView; the palette scrolls its active row into view on every keystroke.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const card = makeCard({ title: "Fix the login page" });
const tagOptions = [
  { tag: "bug", count: 4 },
  { tag: "ui", count: 1 },
];

// Only the props a test sets are open; the rest are closed.
function setup(over: Partial<BoardDialogsProps> = {}) {
  const props = {
    settings: false,
    onCloseSettings: vi.fn(),
    help: false,
    onCloseHelp: vi.fn(),
    tagging: null,
    tagOptions,
    onTagsChange: vi.fn(),
    onCloseTags: vi.fn(),
    sharing: null,
    onCloseShare: vi.fn(),
    sharingBoard: false,
    onCloseShareBoard: vi.fn(),
    palette: false,
    paletteQuery: "",
    paletteItems: () => [],
    findPrompts: () => Promise.resolve([]),
    paletteProject: null,
    onClosePalette: vi.fn(),
    login: null,
    onCloseLogin: vi.fn(),
    switchAllDialog: null,
    deleteDialog: null,
    cards: [card],
    newOpen: false,
    onDropCard: vi.fn(),
    onDropNew: vi.fn(),
    toast: null,
    onDismissToast: vi.fn(),
    ...over,
  } satisfies BoardDialogsProps;
  render(<BoardDialogs {...props} />);
  return props;
}

describe("BoardDialogs", () => {
  it("draws nothing but the stage's own panel when every overlay is closed", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens Settings and closes it through the panel's own close", async () => {
    const props = setup({ settings: true });
    // Settings is the heaviest panel: its first lazy import outruns findBy's one-second default on a busy machine.
    expect(await screen.findByRole("dialog", { name: "Settings" }, { timeout: 15_000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onCloseSettings).toHaveBeenCalled();
  });

  it("opens the shortcuts sheet and closes it on Escape", async () => {
    const props = setup({ help: true });
    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(props.onCloseHelp).toHaveBeenCalled();
  });

  it("tags the card it was handed, offering the board's tag counts", async () => {
    const props = setup({ tagging: card });
    expect(await screen.findByText("Tags · Fix the login page")).toBeInTheDocument();
    // The option list carries the name and the count, which is what the dropdown reads on click.
    await userEvent.type(screen.getByRole("textbox", { name: "Add a tag" }), "b");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["bug4"]);
    await userEvent.click(screen.getByRole("button", { name: /bug/ }));
    expect(props.onTagsChange).toHaveBeenLastCalledWith(["bug"]);
    await userEvent.keyboard("{Escape}");
    expect(props.onCloseTags).toHaveBeenCalled();
  });

  it("shares the card it was handed", async () => {
    const props = setup({ sharing: card });
    expect(await screen.findByText("Share “Fix the login page”")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(props.onCloseShare).toHaveBeenCalled();
  });

  it("shares the board on its own", async () => {
    const props = setup({ sharingBoard: true });
    expect(await screen.findByText("Share the board")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(props.onCloseShareBoard).toHaveBeenCalled();
  });

  it("opens the palette with the query it was given and reads the items through the thunk", async () => {
    const props = setup({
      palette: true,
      paletteQuery: "login",
      paletteItems: () => [
        { id: `card-${card.id}`, cardId: card.id, group: "Cards", label: card.title, icon: "file", run: () => {} },
      ],
    });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    // The query the board typed into its filter box carries in, and the thunk's rows are ranked under it.
    expect(screen.getByRole("combobox")).toHaveValue("login");
    expect(await screen.findByText("Fix the login page")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(props.onClosePalette).toHaveBeenCalled();
  });

  it("logs in to the CLI that needs it", async () => {
    const props = setup({
      login: { backend: "codex", state: "running", output: "waiting for the browser", startedAt: 0 },
    });
    expect(await screen.findByText("Log in to Codex")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(props.onCloseLogin).toHaveBeenCalled();
  });

  it("hands the Switch all modal its own node untouched", () => {
    setup({ switchAllDialog: <p>Switch all to Codex</p> });
    expect(screen.getByText("Switch all to Codex")).toBeInTheDocument();
  });

  it("shows the toast's text, runs its action and dismisses it", async () => {
    const run = vi.fn();
    const props = setup({ toast: { text: "Archived the card", action: { label: "Undo", run } } });
    expect(screen.getByText("Archived the card")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(props.onDismissToast).toHaveBeenCalled();
  });
});