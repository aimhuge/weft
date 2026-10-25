// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_OPENER } from "@/lib/feedback";
import "./test-utils";
import FeedbackDot from "./FeedbackDot";

const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const summary = { title: "Cards vanish after a restart", body: "- The user loses cards" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("FeedbackDot", () => {
  it("opens the interview from the dot and closes on ✕, Escape and an outside click", async () => {
    const user = userEvent.setup();
    render(<><FeedbackDot /><p>outside</p></>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByText(FEEDBACK_OPENER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type your answer…")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close feedback" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    await user.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("interviews, wraps up, sends, and starts over", async () => {
    fetchMock
      .mockReturnValueOnce(reply({ reply: "How often does it happen?", summary: null }))
      .mockReturnValueOnce(reply({ reply: "Thanks! Here's what I'll send.", summary }))
      .mockReturnValueOnce(reply({ sent: true }));
    const user = userEvent.setup();
    render(<FeedbackDot />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.queryByText(/write the summary/)).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Type your answer…"), "Cards vanish{Enter}");
    expect(await screen.findByText("How often does it happen?")).toBeInTheDocument();
    expect(screen.getByText("Cards vanish")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /write the summary/ }));
    expect(await screen.findByText(summary.title)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add more" }));
    expect(screen.getByPlaceholderText("Anything to add or correct?")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Send to the Weft team" }));
    expect(await screen.findByText(/Sent to the Weft team/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New feedback" }));
    expect(screen.queryByText(summary.title)).not.toBeInTheDocument();
  });

  it("keeps Shift+Enter as a new line, skips an empty answer, and says when the send didn't reach weft.zip", async () => {
    fetchMock.mockReturnValueOnce(reply({ reply: "Got it.", summary })).mockReturnValueOnce(reply({ sent: false }));
    const user = userEvent.setup();
    render(<FeedbackDot />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    const box = screen.getByPlaceholderText("Type your answer…");
    await user.type(box, "{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    await user.keyboard("{Enter}");
    await screen.findByText("Got it.");
    await user.click(screen.getByRole("button", { name: "Send to the Weft team" }));
    expect(await screen.findByText(/kept on your Mac/)).toBeInTheDocument();
  });

  it("shows Thinking… while Haiku answers and the error when it fails", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (finish = r)));
    const user = userEvent.setup();
    render(<FeedbackDot />);
    await user.click(screen.getByRole("button", { name: "Feedback" }));
    await user.type(screen.getByPlaceholderText("Type your answer…"), "hi{Enter}");
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    await act(() => {
      finish(new Response(JSON.stringify({ error: "Haiku is down" }), { status: 500 }));
      return new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByText("Haiku is down")).toBeInTheDocument();
  });
});
