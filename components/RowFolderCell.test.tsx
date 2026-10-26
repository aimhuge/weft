// @vitest-environment jsdom
// A list-view row's folder cell: the folder the card runs in, how many other cards share it, and the
// type-ahead picker that moves it elsewhere.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RowFolderCell, { FolderPicker } from "./RowFolderCell";
import { makeCard } from "./test-utils";
import "./test-utils";

afterEach(cleanup);

const card = makeCard({ id: "c1", cwd: "/dev/weft" });

function setup(over: Partial<React.ComponentProps<typeof RowFolderCell>> = {}) {
  const props: React.ComponentProps<typeof RowFolderCell> = { card, alsoHere: [], ...over };
  return { props, view: render(<RowFolderCell {...props} />) };
}

describe("RowFolderCell", () => {
  it("shows the folder the card runs in", () => {
    const { view } = setup();
    expect(view.getByText("weft")).toBeInTheDocument();
  });

  it("leaves the folder alone when there's nothing to move it", () => {
    const { view } = setup();
    expect(view.queryByRole("button", { name: "weft" })).toBeNull();
  });

  it("counts the other cards in the same folder", () => {
    const { view } = setup({ alsoHere: [makeCard({ id: "c2", title: "Another" }), makeCard({ id: "c3", title: "A third" })] });
    expect(view.getByText("+2")).toBeInTheDocument();
    expect(view.getByTitle(/Another/)).toBeInTheDocument();
  });

  it("shows no count when the folder is the card's own", () => {
    const { view } = setup();
    expect(view.queryByText(/^\+\d/)).toBeNull();
  });

  it("opens the picker from the folder", () => {
    const { view } = setup({ onFolder: vi.fn(), folders: ["/dev/weft", "/dev/blastcp"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    expect(view.getByPlaceholderText("Type a folder name or path…")).toBeInTheDocument();
  });

  it("moves the card to the folder you pick", () => {
    const onFolder = vi.fn();
    const { view } = setup({ onFolder, folders: ["/dev/weft", "/dev/blastcp"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    fireEvent.click(screen.getByText("blastcp"));
    expect(onFolder).toHaveBeenCalledWith("/dev/blastcp");
  });

  it("doesn't move the card to the folder it's already in", () => {
    const onFolder = vi.fn();
    const { view } = setup({ onFolder, folders: ["/dev/weft"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    fireEvent.click(screen.getByRole("option", { name: /weft/ }));
    expect(onFolder).not.toHaveBeenCalled();
  });

  it("closes the picker without moving the card", () => {
    const onFolder = vi.fn();
    const { view } = setup({ onFolder, folders: ["/dev/weft", "/dev/blastcp"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    fireEvent.keyDown(view.getByPlaceholderText("Type a folder name or path…"), { key: "Escape" });
    expect(view.queryByPlaceholderText("Type a folder name or path…")).toBeNull();
    expect(onFolder).not.toHaveBeenCalled();
  });

  it("leaves the copilot's folder alone", () => {
    const { view } = setup({ card: makeCard({ id: "copilot", role: "copilot", cwd: "/dev" }), onFolder: vi.fn() });
    expect(view.getByText("whole board")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "whole board" })).toBeNull();
  });

  it("asks the desktop for a folder when it's there", () => {
    const openFolder = vi.fn(() => Promise.resolve<string | null>("/dev/blastcp"));
    window.weft = { dialog: { openFolder } } as unknown as typeof window.weft;
    const onFolder = vi.fn();
    const { view } = setup({ onFolder, folders: ["/dev/weft"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    expect(openFolder).toHaveBeenCalled();
    return vi.waitFor(() => expect(onFolder).toHaveBeenCalledWith("/dev/blastcp"));
  });

  it("stays put when the desktop picker gives nothing back", async () => {
    window.weft = { dialog: { openFolder: vi.fn(() => Promise.resolve(null)) } } as unknown as typeof window.weft;
    const onFolder = vi.fn();
    const { view } = setup({ onFolder, folders: ["/dev/weft"] });
    fireEvent.click(view.getByRole("button", { name: "weft" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Choose folder…" })).toBeInTheDocument());
    expect(onFolder).not.toHaveBeenCalled();
  });
});

describe("FolderPicker", () => {
  const anchor = new DOMRect(0, 0, 100, 20);

  function setup(over: Partial<React.ComponentProps<typeof FolderPicker>> = {}) {
    const props: React.ComponentProps<typeof FolderPicker> = {
      anchor,
      current: "/dev/weft",
      folders: ["/dev/weft", "/dev/blastcp", "/dev/groovenfill"],
      onPick: vi.fn(),
      onClose: vi.fn(),
      ...over,
    };
    return { props, view: render(<FolderPicker {...props} />) };
  }

  it("lists the folders, and marks the one the card is in", () => {
    const { view } = setup();
    expect(view.getAllByRole("option")).toHaveLength(3);
    expect(view.getByText("current")).toBeInTheDocument();
  });

  it("narrows the list as you type", () => {
    const { view } = setup();
    fireEvent.change(view.getByPlaceholderText("Type a folder name or path…"), { target: { value: "blast" } });
    expect(view.getAllByRole("option")).toHaveLength(1);
    expect(view.getByText("blastcp")).toBeInTheDocument();
  });

  it("says when no folder matches", () => {
    const { view } = setup();
    fireEvent.change(view.getByPlaceholderText("Type a folder name or path…"), { target: { value: "zzz" } });
    expect(view.getByText(/No folder matches/)).toBeInTheDocument();
  });

  it("takes a path you type in full", () => {
    const { props, view } = setup();
    fireEvent.change(view.getByPlaceholderText("Type a folder name or path…"), { target: { value: "/tmp/new-thing" } });
    fireEvent.click(view.getByText("/tmp/new-thing"));
    expect(props.onPick).toHaveBeenCalledWith("/tmp/new-thing");
  });

  it("takes the path on Enter", () => {
    const { props, view } = setup();
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.change(box, { target: { value: "/tmp/new-thing" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("/tmp/new-thing");
  });

  it("moves down the list and takes the one you land on", () => {
    const { props, view } = setup();
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("/dev/blastcp");
  });

  it("moves back up the list too", () => {
    const { props, view } = setup();
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("/dev/weft");
  });

  it("highlights a folder as the pointer goes over it", () => {
    const { props, view } = setup();
    fireEvent.mouseEnter(view.getAllByRole("option")[2]!);
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("/dev/groovenfill");
  });

  it("does nothing on Enter when there's nothing to take", () => {
    const { props, view } = setup({ folders: [] });
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("closes when the popover closes", () => {
    const { props, view } = setup();
    fireEvent.keyDown(view.getByPlaceholderText("Type a folder name or path…"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});
