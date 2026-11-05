// @vitest-environment jsdom
// components/ShareCardOptions.tsx: the Share dialog's address field and Show the chat switch. Each saves through
// api.setShare with the current mode, and a bad slug never leaves the dialog.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardShareState } from "@/lib/share-types";
import "./test-utils";

const api = vi.hoisted(() => ({ setShare: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));

const { ShareCardOptions } = await import("./ShareCardOptions");

type Ok = Extract<CardShareState, { kind: "ok" }>;
const STATE: Ok = { kind: "ok", id: "s1", url: "https://weft.zip/@fo/threads/login", mode: "public", hasPassword: false, slug: "login", showChat: true };

function setup(state: Ok = STATE) {
  const setState = vi.fn();
  const setError = vi.fn();
  render(<ShareCardOptions cardId="c1" state={state} setState={setState} setError={setError} />);
  return { setState, setError };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShareCardOptions", () => {
  it("saves the chat switch with the current mode", async () => {
    api.setShare.mockResolvedValueOnce({ ...STATE, showChat: false });
    const { setState } = setup();
    expect(screen.getByText(/beside its browser pane/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(setState).toHaveBeenCalledWith({ ...STATE, showChat: false }));
    expect(api.setShare).toHaveBeenCalledWith("c1", { mode: "public", showChat: false });
  });

  it("says what a hidden chat means, and shows a failed save", async () => {
    api.setShare.mockRejectedValueOnce(new Error("nope"));
    const { setError } = setup({ ...STATE, showChat: false });
    expect(screen.getByText(/only the browser pane/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(setError).toHaveBeenLastCalledWith("nope"));
  });

  it("renames the address on Enter, and skips an unchanged one", async () => {
    api.setShare.mockResolvedValueOnce({ ...STATE, slug: "fix" });
    setup();
    expect(screen.getByText("weft.zip/@fo/threads/")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Address" });
    fireEvent.blur(input);
    expect(api.setShare).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " fix " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(api.setShare).toHaveBeenCalledWith("c1", { mode: "public", slug: "fix" }));
  });

  it("refuses a malformed address without saving", () => {
    const { setError } = setup();
    const input = screen.getByRole("textbox", { name: "Address" });
    fireEvent.change(input, { target: { value: "Not OK" } });
    fireEvent.blur(input);
    expect(setError).toHaveBeenCalledWith("Pick an address of 1 to 40 letters, digits, or hyphens.");
    expect(api.setShare).not.toHaveBeenCalled();
  });

  it("has no address field before the link has a slug address", () => {
    setup({ ...STATE, url: "https://weft.zip/s/s1" });
    expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
    cleanup();
    setup({ ...STATE, slug: null });
    expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  });
});
