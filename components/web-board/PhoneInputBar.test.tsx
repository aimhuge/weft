// @vitest-environment jsdom
// weft.zip's phone-width input bar: Hold to talk sends what was said on letting go, slides up to cancel, and ⊕ opens
// the tray. The recognizer is the browser's (lib/use-dictation.ts), stood in for here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test-utils";
import { clipboardFiles } from "./PhoneTray";
import { phonePrompt } from "./PhoneNewCard";

const mic = vi.hoisted(() => ({ onText: null as null | ((text: string) => void), state: "idle", toggle: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/use-dictation", () => ({
  useDictation: (onText: (text: string) => void) => {
    mic.onText = onText;
    return { state: mic.state, error: null, toggle: mic.toggle, cancel: mic.cancel };
  },
}));

afterEach(() => {
  mic.state = "idle";
  localStorage.clear();
  vi.clearAllMocks();
});

async function bar(over: Partial<import("./PhoneInputBar").PhoneInputBarProps> = {}) {
  const { PhoneInputBar } = await import("./PhoneInputBar");
  const props = { text: "", onText: vi.fn(), field: createRef<HTMLTextAreaElement>(), onSend: vi.fn(), onBacklog: vi.fn(), onFiles: vi.fn(), canBacklog: true, busy: false, ...over };
  render(<PhoneInputBar {...props} />);
  return props;
}

describe("PhoneInputBar", () => {
  it("sends what was said when you let go", async () => {
    const props = await bar();
    const hold = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.pointerDown(hold, { clientY: 500 });
    expect(mic.toggle).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(hold);
    expect(mic.toggle).toHaveBeenCalledTimes(2);
    mic.onText?.("make it blue");
    expect(props.onSend).toHaveBeenCalledWith("make it blue");
  });

  it("cancels when you slide up and let go", async () => {
    mic.state = "recording";
    await bar();
    const hold = screen.getByRole("button", { name: "Release to send" });
    fireEvent.pointerDown(hold, { clientY: 500 });
    fireEvent.pointerMove(hold, { clientY: 400 });
    expect(hold).toHaveTextContent("Release to cancel");
    fireEvent.pointerUp(hold);
    expect(mic.cancel).toHaveBeenCalled();
  });

  it("adds words said outside a hold to the text", async () => {
    const props = await bar({ text: "hi" });
    mic.onText?.("there");
    expect(props.onText).toHaveBeenCalledWith("hi there");
  });

  it("types, sends with ↑, and keeps Backlog behind ⋯ unless the place can't hold one", async () => {
    const props = await bar({ text: "go", canBacklog: false });
    fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "go!" } });
    expect(props.onText).toHaveBeenCalledWith("go!");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(props.onSend).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: "Add to Backlog" })).toBeDisabled();
  });

  it("keeps the chosen mode for the next bar, until it's switched back", async () => {
    await bar();
    fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
    cleanup();
    await bar();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Talk instead" }));
    cleanup();
    await bar();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });

  it("opens the tray and hands back picked files", async () => {
    const props = await bar();
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    for (const label of ["Photos", "Camera", "File", "Paste"]) expect(screen.getByText(label)).toBeInTheDocument();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onFiles).toHaveBeenCalledWith([file]);
  });
});

describe("the phone's prompt and clipboard", () => {
  it("puts the typed words, the said words, then the files", () => {
    expect(phonePrompt(" a ", " b ", [{ name: "s.png", path: "/attachments/s.png" }])).toBe("a\n\nb\n\n![s.png](/attachments/s.png)");
    expect(phonePrompt("a", undefined, [])).toBe("a");
  });

  it("reads pictures off the clipboard, and nothing where it can't", async () => {
    const png = new Blob(["x"], { type: "image/png" });
    const getType = () => Promise.resolve(png);
    const clipboard = { read: () => Promise.resolve([{ types: ["text/plain"], getType }, { types: ["image/png"], getType }]) } as unknown as Clipboard;
    const files = await clipboardFiles(clipboard);
    expect(files.map((f) => f.name)).toEqual(["paste.png"]);
    expect(await clipboardFiles({})).toEqual([]);
  });
});
