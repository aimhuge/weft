// @vitest-environment jsdom
// The list view's quick add: a row you just type into. In the Backlog, Enter files a card with that
// title; in Running, Enter starts a thread on it. The folder chip says where it goes and changes it.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SheetQuickAdd from "./SheetQuickAdd";
import "./test-utils";

const api = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve({ card: {} })),
  settings: vi.fn(() => Promise.resolve({ defaultBackend: "puku" })),
}));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof SheetQuickAdd>> = {}) {
  const props: React.ComponentProps<typeof SheetQuickAdd> = {
    column: "backlog",
    folders: ["/dev/weft"],
    focus: false,
    onMore: vi.fn(),
    ...over,
  };
  return { props, view: render(<SheetQuickAdd {...props} />) };
}

describe("SheetQuickAdd", () => {
  it("asks for a card's title in the Backlog", () => {
    const { view } = setup();
    expect(view.getByLabelText("New Backlog card title")).toBeInTheDocument();
    expect(view.getByPlaceholderText(/Add to the Backlog/)).toBeInTheDocument();
  });

  it("asks for what to do in Running", () => {
    const { view } = setup({ column: "running" });
    expect(view.getByLabelText("Start a thread")).toBeInTheDocument();
    expect(view.getByPlaceholderText(/Start a thread: say what to do/)).toBeInTheDocument();
  });

  it("takes the cursor when it's the band's turn", () => {
    const { view } = setup({ focus: true });
    expect(view.getByLabelText("New Backlog card title")).toHaveFocus();
  });

  it("files a card from just its title, and clears the box", async () => {
    const { view } = setup();
    const box = view.getByLabelText("New Backlog card title");
    fireEvent.change(box, { target: { value: "Dark mode for the sheet" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(view.getByText("✓ 1 added")).toBeInTheDocument());
    expect(api.create).toHaveBeenCalledWith({ title: "Dark mode for the sheet", prompt: "Dark mode for the sheet", start: false, cwd: "/dev/weft", backend: "puku" });
    expect(box).toHaveValue("");
  });

  it("starts a thread from what you typed, in Running", async () => {
    const { view } = setup({ column: "running" });
    const box = view.getByLabelText("Start a thread");
    fireEvent.change(box, { target: { value: "fix the tests" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ prompt: "fix the tests", start: true, cwd: "/dev/weft", backend: "puku" }));
  });

  it("files the next idea after the last one, in the same box", async () => {
    const { view } = setup();
    const box = view.getByLabelText("New Backlog card title");
    fireEvent.change(box, { target: { value: "one" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(view.getByText("✓ 1 added")).toBeInTheDocument());
    fireEvent.change(box, { target: { value: "two" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(view.getByText("✓ 2 added")).toBeInTheDocument());
    expect(api.create).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an empty box", () => {
    const { view } = setup();
    fireEvent.keyDown(view.getByLabelText("New Backlog card title"), { key: "Enter" });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does nothing for a box of only spaces", () => {
    const { view } = setup();
    const box = view.getByLabelText("New Backlog card title");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("gives the words back when the card can't be made", async () => {
    const notify = vi.fn();
    api.create.mockRejectedValueOnce(new Error("no"));
    const { view } = setup({ notify });
    const box = view.getByLabelText("New Backlog card title");
    fireEvent.change(box, { target: { value: "Dark mode" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(box).toHaveValue("Dark mode");
  });

  it("lets the cursor go on Escape", () => {
    const { view } = setup({ focus: true });
    const box = view.getByLabelText("New Backlog card title");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).not.toHaveFocus();
  });

  it("says which folder the card goes in", () => {
    const { view } = setup();
    expect(view.getByTitle("Goes in /dev/weft. Click to pick another folder")).toBeInTheDocument();
    expect(view.getByText("weft")).toBeInTheDocument();
  });

  it("has no folder chip when there's no folder to go in", () => {
    const { view } = setup({ folders: [] });
    expect(view.queryByTitle(/Goes in/)).toBeNull();
  });

  it("changes the folder from the picker", async () => {
    const { view } = setup({ folders: ["/dev/weft", "/dev/blastcp"] });
    fireEvent.click(view.getByText("weft"));
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.change(box, { target: { value: "blast" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(view.getByTitle("Goes in /dev/blastcp. Click to pick another folder")).toBeInTheDocument());
    const add = view.getByLabelText("New Backlog card title");
    fireEvent.change(add, { target: { value: "A card" } });
    fireEvent.keyDown(add, { key: "Enter" });
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/dev/blastcp" })));
  });

  it("opens New thread from More…", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "More…" }));
    expect(props.onMore).toHaveBeenCalled();
  });

  it("closes the folder picker without changing the folder", () => {
    const { view } = setup({ folders: ["/dev/weft", "/dev/blastcp"] });
    fireEvent.click(view.getByText("weft"));
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(view.queryByPlaceholderText("Type a folder name or path…")).toBeNull();
    expect(view.getByTitle("Goes in /dev/weft. Click to pick another folder")).toBeInTheDocument();
  });
});
