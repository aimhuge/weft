// @vitest-environment jsdom
// "!" in the reply box: a shell command instead of a message (lib/shell.ts runs it).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import ReplyBox from "./ReplyBox";

vi.mock("@/lib/client", () => ({ api: {} }));
vi.mock("./Composer", () => import("./composer-mock"));

type Props = Parameters<typeof ReplyBox>[0];

function setup(props: Partial<Props> = {}) {
  const onSend = vi.fn<Props["onSend"]>(() => Promise.resolve());
  const onShell = vi.fn<NonNullable<Props["onShell"]>>(() => Promise.resolve());
  const onStop = vi.fn<Props["onStop"]>(() => Promise.resolve());
  render(<ReplyBox cardId="c1" cwd="/repo" live={false} placeholder="Reply…" onSend={onSend} onShell={onShell} onStop={onStop} {...props} />);
  return { onSend, onShell, onStop, box: screen.getByRole("textbox", { name: "Message" }) };
}

beforeEach(() => localStorage.clear());

describe("ReplyBox ! shell mode", () => {
  it("runs a ! command instead of sending it, and empties the box", async () => {
    const { onSend, onShell, box } = setup();
    await userEvent.type(box, "!git status{Enter}");
    expect(onShell).toHaveBeenCalledWith("git status");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("");
  });

  it("turns Send into Run while the box starts with !", async () => {
    const { box } = setup();
    await userEvent.type(box, "!ls");
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByText("Shell · repo")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "ls");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("runs mid-turn rather than queueing, and drops Send now", async () => {
    const { onShell, box } = setup({ live: true });
    await userEvent.type(box, "!pwd");
    expect(screen.queryByRole("button", { name: "More ways to send" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onShell).toHaveBeenCalledWith("pwd");
  });

  it("where there's no shell (a worker's card), turns amber and says why, and sends nothing", async () => {
    const { onSend, box } = setup({ onShell: undefined, noShell: "A shell runs only on this Mac's cards." });
    await userEvent.type(box, "!ls");
    expect(screen.getByText("A shell runs only on this Mac's cards.")).toBeInTheDocument();
    expect(screen.getByText("Shell · repo")).toBeInTheDocument();
    await userEvent.type(box, "{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("!ls");
    await userEvent.clear(box);
    await userEvent.type(box, "ls");
    expect(screen.queryByText("A shell runs only on this Mac's cards.")).toBeNull();
  });

  it("asks for a command after a bare !", async () => {
    const { onShell, box } = setup();
    await userEvent.type(box, "!{Enter}");
    expect(onShell).not.toHaveBeenCalled();
    expect(screen.getByText("Write a command after the !.")).toBeInTheDocument();
  });

  it("shows why a command didn't run and keeps it in the box", async () => {
    const { onShell, box } = setup();
    onShell.mockRejectedValueOnce(new Error("Not run, since its output goes to Claude"));
    await userEvent.type(box, "!cat .env{Enter}");
    expect(await screen.findByText("Not run, since its output goes to Claude")).toBeInTheDocument();
    expect(box).toHaveValue("!cat .env");
  });

  it("sends a reply that starts with a pasted picture as a message", async () => {
    const { onSend, onShell, box } = setup();
    await userEvent.type(box, "![[shot](/a.png) why?{Enter}");
    expect(onShell).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledWith("![shot](/a.png) why?");
  });

  it("sends ! as text where there's no shell (the copilot)", async () => {
    const { onSend, box } = setup({ onShell: undefined });
    await userEvent.type(box, "!hi{Enter}");
    expect(onSend).toHaveBeenCalledWith("!hi");
  });
});
