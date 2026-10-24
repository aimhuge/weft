// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import ReviewPanel from "./ReviewPanel";

vi.mock("@/lib/client", () => ({ api: { devAction: vi.fn(() => Promise.resolve({ status: {} })) } }));
vi.mock("./Composer", () => import("./composer-mock"));

const review = { steps: [{ title: "First", look: "a" }, { title: "Second", look: "b" }] };
const card = makeCard({ id: "c1", review });

function setup() {
  const onSend = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  const view = render(<ReviewPanel card={card} items={[]} onSend={onSend} />);
  return { onSend, view };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("ReviewPanel feedback draft", () => {
  it("keeps what was typed when the card is closed and reopened", async () => {
    const first = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "half a thought");
    first.view.unmount();
    setup();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("half a thought");
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  });

  it("keeps a separate draft per step", async () => {
    setup();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "one");
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(box).toHaveValue("");
    await userEvent.type(box, "two");
    await userEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(box).toHaveValue("one");
  });

  it("drops the draft once the feedback is sent", async () => {
    const { onSend } = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "broken{Enter}");
    expect(onSend).toHaveBeenCalled();
    expect(localStorage.getItem("weft.review.c1.0")).toBeNull();
  });

  it("brings what was typed in the reply box along when the tour takes its place", () => {
    localStorage.setItem("weft.reply.c1", "wehn i hold cmd");
    setup();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("wehn i hold cmd");
    expect(localStorage.getItem("weft.reply.c1")).toBeNull();
    expect(localStorage.getItem("weft.review.c1.0")).toBe("wehn i hold cmd");
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeEnabled();
  });

  it("adds the reply box's text after feedback already written for the step", () => {
    localStorage.setItem("weft.review.c1.0", "earlier note");
    localStorage.setItem("weft.reply.c1", "new thought");
    setup();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("earlier note\n\nnew thought");
  });

  // The reply box writes its last keystrokes as it unmounts, in the same commit the tour mounts in.
  it("picks up keystrokes the reply box writes while it unmounts", () => {
    function LeavingReplyBox() {
      useEffect(() => () => localStorage.setItem("weft.reply.c1", "typed just now"), []);
      return null;
    }
    const onSend = vi.fn(() => Promise.resolve());
    const view = render(<LeavingReplyBox />);
    view.rerender(<ReviewPanel card={card} items={[]} onSend={onSend} />);
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("typed just now");
  });
});

describe("ReviewPanel dropped files", () => {
  it("takes files dropped on its card, since it stands in for the reply box", () => {
    setup();
    expect(screen.getByRole("textbox", { name: "Message" }).closest("[data-handed-to]")).toHaveAttribute("data-handed-to", "c1");
  });
});

// The feedback you write on a step must never become unreachable: stepping on keeps it, and
// finishing the review sends it.
describe("ReviewPanel unsent feedback", () => {
  it("says how many steps still hold feedback you haven't sent", async () => {
    setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "the login is broken");
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText(/1 step with unsent feedback/)).toBeTruthy();
  });

  it("keeps the feedback you wrote when you step away from a step", async () => {
    setup();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "the login is broken");
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(box).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(box).toHaveValue("the login is broken");
  });

  it("sends the feedback you wrote on a step when you step on", async () => {
    const { onSend } = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "the login is broken");
    await userEvent.click(screen.getByRole("button", { name: "Looks good, next" }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("the login is broken"));
  });

  it("sends the feedback you wrote on the last step when you finish", async () => {
    const { onSend } = setup();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    await userEvent.type(box, "the logo is wrong");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("the logo is wrong"));
    expect(onSend).toHaveBeenCalledWith("/weft:done");
  });

  it("sends the feedback of every step that still holds some, in one message", async () => {
    const { onSend } = setup();
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "the login is broken");
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    await userEvent.type(box, "the logo is wrong");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    const message = onSend.mock.calls.map((call) => call[0]).find((text) => text.includes("the login is broken"));
    expect(message).toContain("the login is broken");
    expect(message).toContain("the logo is wrong");
  });
});
