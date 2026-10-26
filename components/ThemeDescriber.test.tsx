// @vitest-environment jsdom
// The describe-a-theme box: the words you write, the picture you drop on it, and the thread it starts.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThemeDescriber, { DescribeTile } from "./ThemeDescriber";
import "./test-utils";

const api = vi.hoisted(() => ({ createTheme: vi.fn(), themeFromPicture: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

const revoke = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:beach");
  URL.revokeObjectURL = revoke;
});

afterEach(cleanup);

const beach = () => new File(["x"], "beach.jpg", { type: "image/jpeg" });
const drop = (el: Element, files: File[]) => fireEvent.drop(el, { dataTransfer: { files, types: ["Files"] } });

describe("DescribeTile", () => {
  it("opens the describe box", () => {
    const onOpen = vi.fn();
    const view = render(<DescribeTile onOpen={onOpen} />);
    fireEvent.click(view.getByRole("button", { name: /your own/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("takes a picture dropped on it", () => {
    const onOpen = vi.fn();
    const view = render(<DescribeTile onOpen={onOpen} />);
    const tile = view.getByRole("button", { name: /your own/i });
    // The dragover has to be refused for the drop to fire.
    expect(fireEvent.dragOver(tile, { dataTransfer: { files: [], types: ["Files"] } })).toBe(false);
    drop(tile, [beach()]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "beach.jpg" }));
  });

  it("ignores a file that isn't a picture", () => {
    const onOpen = vi.fn();
    const view = render(<DescribeTile onOpen={onOpen} />);
    const tile = view.getByRole("button", { name: /your own/i });
    drop(tile, [new File(["t"], "notes.txt", { type: "text/plain" })]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("ThemeDescriber", () => {
  function setup(over: Partial<React.ComponentProps<typeof ThemeDescriber>> = {}) {
    const props: React.ComponentProps<typeof ThemeDescriber> = { onStarted: vi.fn(), onClose: vi.fn(), ...over };
    return { props, view: render(<ThemeDescriber {...props} />) };
  }

  it("waits for something to describe before it starts", () => {
    const { view } = setup();
    expect(view.getByRole("button", { name: "Paint it" })).toBeDisabled();
  });

  it("starts a thread from the words you write", async () => {
    api.createTheme.mockResolvedValue({ id: "tokyo" });
    const { props, view } = setup();
    const box = view.getByPlaceholderText(/rainy tokyo/i);
    fireEvent.change(box, { target: { value: "tokyo at night" } });
    fireEvent.click(view.getByRole("button", { name: "Paint it" }));
    await waitFor(() => expect(api.createTheme).toHaveBeenCalledWith("tokyo at night"));
    expect(props.onStarted).toHaveBeenCalledWith("tokyo");
  });

  it("starts on Enter, without a newline", async () => {
    api.createTheme.mockResolvedValue({ id: "tokyo" });
    const { view } = setup();
    const box = view.getByPlaceholderText(/rainy tokyo/i);
    fireEvent.change(box, { target: { value: "tokyo at night" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.createTheme).toHaveBeenCalledWith("tokyo at night"));
  });

  it("leaves a newline alone, so you can write a paragraph", () => {
    const { view } = setup();
    const box = view.getByPlaceholderText(/rainy tokyo/i);
    fireEvent.change(box, { target: { value: "tokyo at night" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(api.createTheme).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { props, view } = setup();
    fireEvent.keyDown(view.getByPlaceholderText(/rainy tokyo/i), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes from the Cancel button", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("takes a picture dropped on the box, and says the words are optional", () => {
    const { view } = setup();
    const form = view.getByRole("button", { name: "Paint it" }).closest("form")!;
    drop(form, [beach()]);
    expect(view.getByRole("button", { name: "Theme it" })).toBeEnabled();
    expect(view.getByPlaceholderText(/optional/i)).toBeInTheDocument();
  });

  it("builds the theme around the picture when there is one", async () => {
    api.themeFromPicture.mockResolvedValue({ id: "beach" });
    const { props, view } = setup();
    fireEvent.change(view.getByLabelText("Theme picture"), { target: { files: [beach()] } });
    fireEvent.change(view.getByPlaceholderText(/optional/i), { target: { value: "warm and quiet" } });
    fireEvent.click(view.getByRole("button", { name: "Theme it" }));
    await waitFor(() => expect(api.themeFromPicture).toHaveBeenCalledWith("warm and quiet", expect.objectContaining({ name: "beach.jpg" })));
    expect(props.onStarted).toHaveBeenCalledWith("beach");
  });

  it("opens with a picture it was handed", () => {
    const { view } = setup({ initialPicture: beach() });
    expect(view.getByRole("button", { name: "Theme it" })).toBeEnabled();
    expect(view.getByPlaceholderText(/optional/i)).toBeInTheDocument();
  });

  it("takes the picture away again, and gives its preview back", () => {
    const { view } = setup({ initialPicture: beach() });
    fireEvent.click(view.getByRole("button", { name: "Remove the picture" }));
    expect(view.getByRole("button", { name: "Paint it" })).toBeDisabled();
    expect(revoke).toHaveBeenCalledWith("blob:beach");
  });

  it("opens the file picker from the picture slot", () => {
    const { view } = setup();
    const slot = view.getByTitle(/Use your own picture as the backdrop/);
    const picker = view.getByLabelText("Theme picture") as HTMLInputElement;
    const click = vi.spyOn(picker, "click");
    fireEvent.click(slot);
    expect(click).toHaveBeenCalled();
  });

  it("opens the file picker from the picture slot, when there's a picture", () => {
    const { view } = setup({ initialPicture: beach() });
    const slot = view.getByTitle(/beach.jpg: click to pick another/);
    const picker = view.getByLabelText("Theme picture") as HTMLInputElement;
    const click = vi.spyOn(picker, "click");
    fireEvent.click(slot);
    expect(click).toHaveBeenCalled();
  });

  it("keeps the picture when the file picker is cleared without a file", () => {
    const { view } = setup({ initialPicture: beach() });
    fireEvent.change(view.getByLabelText("Theme picture"), { target: { files: [] } });
    expect(view.getByRole("button", { name: "Theme it" })).toBeEnabled();
  });

  it("shows the failure in place, and doesn't start", async () => {
    api.createTheme.mockRejectedValue(new Error("No folder"));
    const { props, view } = setup();
    fireEvent.change(view.getByPlaceholderText(/rainy tokyo/i), { target: { value: "x" } });
    fireEvent.click(view.getByRole("button", { name: "Paint it" }));
    await waitFor(() => expect(view.getByText("No folder")).toBeInTheDocument());
    expect(props.onStarted).not.toHaveBeenCalled();
  });

  it("shows a failure that isn't an Error as it is", async () => {
    api.createTheme.mockRejectedValue("plain trouble");
    const { view } = setup();
    fireEvent.change(view.getByPlaceholderText(/rainy tokyo/i), { target: { value: "x" } });
    fireEvent.click(view.getByRole("button", { name: "Paint it" }));
    await waitFor(() => expect(view.getByText("plain trouble")).toBeInTheDocument());
  });

  it("says the picture stays the backdrop when there is one", () => {
    const { view } = setup({ initialPicture: beach() });
    expect(view.getByText(/Your picture stays the backdrop/)).toBeInTheDocument();
  });

  it("says a new card paints the picture when there isn't one", () => {
    const { view } = setup();
    expect(view.getByText(/A new card paints the picture/)).toBeInTheDocument();
  });

  it("ignores a dragover that isn't carrying files", () => {
    const { view } = setup();
    const form = view.getByRole("button", { name: "Paint it" }).closest("form")!;
    expect(fireEvent.dragOver(form, { dataTransfer: { files: [], types: ["text/plain"] } })).toBe(true);
  });
});
