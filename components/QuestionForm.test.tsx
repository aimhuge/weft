// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Question } from "@/lib/types";
import type { ComposerHandle } from "./Composer";
import QuestionForm, { ARM_MS, type QuestionFormHandle } from "./QuestionForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { weft?: unknown }).weft;
});

const ONE: Question[] = [
  {
    question: "Which layout?",
    header: "Layout",
    options: [
      { label: "Sidebar", description: "Nav on the left", preview: "| Nav | Content |" },
      { label: "Top bar", preview: "[ Nav ]\n Content" },
    ],
  },
];

const TWO: Question[] = [
  { question: "Which sign-in methods?", header: "Providers", multiSelect: true, options: [{ label: "GitHub" }, { label: "Google" }] },
  { question: "Required?", header: "Required", options: [{ label: "Optional" }, { label: "Required" }] },
];

// The reply box's composer, as the form sees it: a text box it reads, writes and clears.
function fakeComposer(initial = "") {
  let text = initial;
  const focus = vi.fn();
  const handle: ComposerHandle = {
    focus,
    read: () => text,
    readText: () => text,
    clear: () => (text = ""),
    write: (markdown) => (text = markdown),
    isEmpty: () => text === "",
  };
  return { handle, focus, get text() { return text; }, set text(t: string) { text = t; } };
}

// The clock the form reads: shown at 1000 ms; unless `fresh`, the hold (ARM_MS) is already over.
function setup(
  questions: Question[],
  opts: { box?: string; readScope?: { directory: string; token: string }; previewUrl?: string; fresh?: boolean; answer?: () => unknown } = {},
) {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const box = fakeComposer(opts.box);
  const composer = { current: box.handle };
  const form = createRef<QuestionFormHandle>();
  const onAnswer = vi.fn(opts.answer);
  const onDecline = vi.fn();
  const onReadScope = vi.fn();
  render(
    <QuestionForm
      ref={form}
      cardId="c1"
      composer={composer}
      questions={questions}
      readScope={opts.readScope}
      previewUrl={opts.previewUrl}
      onAnswer={onAnswer}
      onDecline={onDecline}
      onReadScope={onReadScope}
    />,
  );
  const wait = (ms: number) => (now += ms);
  if (!opts.fresh) wait(ARM_MS);
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => {
    let used = false;
    act(() => {
      used = form.current!.key({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods } as KeyboardEvent, box.text === "");
    });
    return used;
  };
  const enter = () => act(() => form.current!.enter());
  return { box, onAnswer, onDecline, onReadScope, key, enter, wait };
}

const highlighted = () => screen.getAllByRole("option").findIndex((o) => o.querySelector(".text-accent")?.textContent === "❯");

describe("QuestionForm", () => {
  it("sends a single question as soon as an option is clicked", () => {
    const { onAnswer } = setup(ONE);
    expect(screen.getByText("The agent has a question")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Top bar/ }));
    expect(onAnswer).toHaveBeenCalledWith({ "Which layout?": "Top bar" }, { "Which layout?": { preview: "[ Nav ]\n Content" } });
  });

  it("takes the box's text as your own answer, or as a note on your pick", () => {
    const own = setup(ONE, { box: "A drawer instead" });
    own.enter();
    expect(own.onAnswer).toHaveBeenCalledWith({ "Which layout?": "A drawer instead" }, {});
    expect(own.box.text).toBe("");
    cleanup();
    const noted = setup(ONE, { box: "but narrow" });
    fireEvent.click(screen.getByRole("option", { name: /Sidebar/ }));
    expect(noted.onAnswer).toHaveBeenCalledWith(
      { "Which layout?": "Sidebar" },
      { "Which layout?": { notes: "but narrow", preview: "| Nav | Content |" } },
    );
  });

  it("moves with the arrows and picks by number or Enter, only while the box is empty", () => {
    const { key, enter, onAnswer, box } = setup(ONE);
    expect(highlighted()).toBe(0);
    expect(key("ArrowDown")).toBe(true);
    expect(highlighted()).toBe(1);
    expect(key("ArrowUp")).toBe(true);
    expect(key("ArrowUp")).toBe(true);
    expect(highlighted()).toBe(1);
    expect(key("ArrowLeft")).toBe(false); // one question: no tabs
    expect(key("9")).toBe(false);
    expect(key("x")).toBe(false);
    expect(key("1", { metaKey: true })).toBe(false);
    box.text = "typing";
    expect(key("ArrowDown")).toBe(false);
    box.text = "";
    fireEvent.mouseEnter(screen.getByRole("option", { name: /Sidebar/ }));
    expect(highlighted()).toBe(0);
    enter();
    expect(onAnswer).toHaveBeenCalledWith({ "Which layout?": "Sidebar" }, { "Which layout?": { preview: "| Nav | Content |" } });
    // Sent: nothing more goes out.
    expect(key("2")).toBe(false);
    enter();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("walks several questions as tabs, ticks multi-select, and reviews before sending", () => {
    const { key, enter, onAnswer, box } = setup(TWO);
    expect(screen.getByRole("button", { name: /Providers/ })).toBeTruthy();
    // Multi-select: Enter on an empty box ticks the highlighted option and stays.
    enter();
    expect(screen.getByRole("option", { name: /GitHub/ }).getAttribute("aria-selected")).toBe("true");
    expect(key(" ")).toBe(true);
    expect(screen.getByRole("option", { name: /GitHub/ }).getAttribute("aria-selected")).toBe("false");
    expect(key("2")).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: /GitHub/ }));
    expect(screen.getByText("Which sign-in methods?")).toBeTruthy();
    // Enter with picks moves on to the next unanswered question.
    enter();
    expect(screen.getByText("Required?", { selector: "p" })).toBeTruthy();
    box.text = "if possible";
    fireEvent.click(screen.getByRole("option", { name: /^2\.\s*Required/ }));
    expect(screen.getByText("Review your answers")).toBeTruthy();
    expect(screen.getByText("Google, GitHub")).toBeTruthy();
    expect(screen.getByText("Note: if possible")).toBeTruthy();
    expect(key("ArrowDown")).toBe(false); // the Submit tab has no options
    enter();
    expect(onAnswer).toHaveBeenCalledWith(
      { "Which sign-in methods?": "Google, GitHub", "Required?": "Required" },
      { "Required?": { notes: "if possible" } },
    );
  });

  it("keeps each question's text with it across tabs, and sends you back to one left unanswered", () => {
    const { key, enter, onAnswer, box } = setup(TWO);
    box.text = "SSO too";
    fireEvent.click(screen.getByRole("button", { name: /Required/ }));
    expect(box.text).toBe("");
    expect(key("ArrowLeft")).toBe(true);
    expect(box.text).toBe("SSO too");
    box.text = "";
    expect(key("ArrowRight")).toBe(true);
    expect(key("ArrowRight")).toBe(true);
    expect(screen.getAllByText("not answered")).toHaveLength(2);
    enter();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText(/Answer “Providers” first/)).toBeTruthy();
    expect(screen.getByText("Which sign-in methods?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Submit/ }));
    fireEvent.click(screen.getByRole("button", { name: /Providers:/ }));
    expect(screen.getByText("Which sign-in methods?")).toBeTruthy();
  });

  it("text typed on the Submit tab goes with the answers as a note, not as Chat about this", () => {
    const { key, enter, onAnswer, onDecline, box } = setup(TWO);
    expect(key("1")).toBe(true);
    enter();
    expect(key("1")).toBe(true);
    expect(screen.getByText("Review your answers")).toBeTruthy();
    box.text = "Ship it behind a flag";
    enter();
    expect(onAnswer).toHaveBeenCalledWith(
      { "Which sign-in methods?": "GitHub", "Required?": "Optional" },
      { "Which sign-in methods?": { notes: "On all answers: Ship it behind a flag" } },
    );
    expect(box.text).toBe("");    expect(onDecline).not.toHaveBeenCalled();
  });

  it("reads the box as typed while an upload keeps it from reading as Markdown", () => {
    const { box, enter, onAnswer } = setup(ONE, { box: "my own" });
    box.handle.read = () => {
      throw new Error("Still uploading");
    };
    enter();
    expect(onAnswer).toHaveBeenCalledWith({ "Which layout?": "my own" }, {});
  });

  it("Type something focuses the box", () => {
    const { box } = setup(ONE);
    fireEvent.click(screen.getByRole("button", { name: /Type something/ }));
    expect(box.focus).toHaveBeenCalled();
  });

  it("Read from grants the folder and answers with it", () => {
    const { onAnswer, onReadScope } = setup(TWO, { readScope: { directory: "/dev/deckcp", token: "~/dev/deckcp" }, box: "the login page" });
    fireEvent.click(screen.getByRole("option", { name: /GitHub/ }));
    fireEvent.click(screen.getByRole("button", { name: /Read from ~\/dev\/deckcp/ }));
    expect(onReadScope).toHaveBeenCalledWith("/dev/deckcp");
    expect(onAnswer).toHaveBeenCalledWith(
      {
        "Which sign-in methods?": "GitHub, You can read from /dev/deckcp — try again",
        "Required?": "You can read from /dev/deckcp — try again",
      },
      {},
    );
    expect(screen.queryByRole("button", { name: /Read from/ })).toBeNull();
  });

  it("shows the highlighted option's preview in the browser pane, or under the options without one", () => {
    const open = vi.fn(() => Promise.resolve());
    (window as { weft?: unknown }).weft = { browser: { open } };
    const { key } = setup(ONE, { previewUrl: "file:///show/c1-question.html" });
    expect(open).toHaveBeenLastCalledWith("file:///show/c1-question.html#0-0", "c1");
    key("ArrowDown");
    expect(open).toHaveBeenLastCalledWith("file:///show/c1-question.html#0-1", "c1");
    expect(screen.queryByText("| Nav | Content |")).toBeNull();
    cleanup();
    delete (window as { weft?: unknown }).weft;
    setup(ONE);
    expect(screen.getByText("| Nav | Content |")).toBeTruthy();
  });

  it("holds a send, a pick or a click that lands as the question appears, and keeps the box's text", () => {
    const { box, onAnswer, key, enter, wait } = setup(ONE, { box: "and also rename the file", fresh: true });
    enter();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(box.text).toBe("and also rename the file");
    expect(screen.getByText(/that send was held/)).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Top bar/ }));
    box.text = "";
    expect(key("1")).toBe(true); // swallowed, not picked
    expect(onAnswer).not.toHaveBeenCalled();
    expect(key("ArrowDown")).toBe(true); // moving is harmless
    expect(highlighted()).toBe(1);
    wait(ARM_MS);
    enter();
    expect(onAnswer).toHaveBeenCalledWith({ "Which layout?": "Top bar" }, { "Which layout?": { preview: "[ Nav ]\n Content" } });
  });

  it("comes back with the box's text and an error when the answer doesn't reach the agent", async () => {
    let fail = true;
    const { box, onAnswer, enter } = setup(ONE, { box: "my own layout", answer: () => (fail ? Promise.reject(new Error("offline")) : undefined) });
    enter();
    expect(box.text).toBe("");
    await act(async () => {});
    expect(screen.getByText(/Couldn't send that: offline/)).toBeTruthy();
    expect(box.text).toBe("my own layout");
    fail = false;
    enter();
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith({ "Which layout?": "my own layout" }, expect.anything());
  });

  it("skips, or sends the box's text to talk it over instead", () => {
    const first = setup(ONE);
    fireEvent.click(screen.getByText("Chat about this"));
    expect(first.onDecline).not.toHaveBeenCalled();
    expect(screen.getByText(/Write what you'd like to say/)).toBeTruthy();
    expect(first.box.focus).toHaveBeenCalled();
    first.box.text = "why not both?";
    fireEvent.click(screen.getByText("Chat about this"));
    expect(first.onDecline).toHaveBeenCalledWith("why not both?");
    expect(first.box.text).toBe("");
    expect(screen.queryByText("Skip")).toBeNull(); // sent: no second decline
    cleanup();
    const second = setup(ONE, { box: "draft" });
    fireEvent.click(screen.getByText("Skip"));
    expect(second.onDecline).toHaveBeenCalledWith("");
    expect(second.box.text).toBe("draft");
    expect(second.onAnswer).not.toHaveBeenCalled();
  });

  it("minimizes to its title row so the thread can be read, and a key opens it again", () => {
    const { key } = setup(ONE);
    fireEvent.click(screen.getByRole("button", { name: "Minimize the question" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Which layout?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the question" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Minimize the question" }));
    expect(key("ArrowDown")).toBe(true);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});
