// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView, { BackendBadge } from "./CardView";

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve()),
  switchBackend: vi.fn(() => Promise.resolve() as Promise<unknown>),
}));
vi.mock("@/lib/client", () => ({ api }));

const pending = { id: "p1", toolName: "Bash", title: "Run npm test", input: {} };

function renderCard(over: Parameters<typeof makeCard>[0] = {}, props: Partial<Parameters<typeof CardView>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onAnswer: vi.fn(), onStop: vi.fn() };
  render(<CardView card={makeCard(over)} now={0} selected={false} {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe("CardView", () => {
  it("shows the title, the last line, the folder and the stage", () => {
    renderCard({ lastLine: "Tests pass.", stage: "Polishing", remaining: "commit" });
    expect(screen.getByText("Fix the login page")).toBeInTheDocument();
    expect(screen.getByText("Tests pass.")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("Polishing")).toBeInTheDocument();
    expect(screen.getByText("· commit")).toBeInTheDocument();
  });

  it("names the model beside the CLI dot once it's known, with the effort in its tooltip", () => {
    renderCard({ stats: { runsOn: { model: "claude-opus-5-5", effort: "high" } } });
    expect(screen.getByText("Opus 5.5")).toHaveAttribute("title", "Claude Code on claude-opus-5-5 · high effort");
  });

  it("shows no model before the CLI reports one", () => {
    renderCard();
    expect(screen.queryByText(/Opus|Sonnet|Fable|Haiku/)).not.toBeInTheDocument();
  });

  it("shows the error instead of the last line", () => {
    renderCard({ lastLine: "Working", error: "CLI crashed" });
    expect(screen.getByText("CLI crashed")).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });

  it("▶ sends continue on an idle card with a session, without opening the thread", async () => {
    const onResume = vi.fn();
    const { onOpen } = renderCard({ lastLine: "I'll stop here.", sessionId: "s1" }, { onResume });
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onResume).toHaveBeenCalledWith("continue");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  });

  it("a stopped card also offers Restart; a running one offers neither", async () => {
    const onResume = vi.fn();
    renderCard({ lastLine: "Stopped", sessionId: "s1" }, { onResume });
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onResume).toHaveBeenCalledWith("restart");
    cleanup();
    renderCard({ column: "running", sessionId: "s1" }, { onResume });
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  });

  it("opens on click", async () => {
    const { onOpen } = renderCard();
    await userEvent.click(screen.getByText("Fix the login page"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  describe("+N here", () => {
    const others = [makeCard({ id: "c2", title: "Other", column: "running" }), makeCard({ id: "c3", title: "Third", column: "running" })];

    it("flags other busy cards in the folder while this one is busy", () => {
      renderCard({ column: "running" }, { alsoHere: others });
      expect(screen.getByText("+2 here")).toBeInTheDocument();
    });

    it("stays hidden when this card isn't busy", () => {
      renderCard({ column: "review" }, { alsoHere: others });
      expect(screen.queryByText(/here$/)).not.toBeInTheDocument();
    });

    it("stays hidden when nothing else is busy here", () => {
      renderCard({ column: "running" }, { alsoHere: [] });
      expect(screen.queryByText(/here$/)).not.toBeInTheDocument();
    });
  });

  it("Allow and Deny answer the permission once, without opening the card", async () => {
    const { onAnswer, onOpen } = renderCard({ column: "needs_you", pending });
    const allow = screen.getByRole("button", { name: "Allow" });
    await userEvent.click(allow);
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
    // A second click can't answer it again.
    expect(allow).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    await userEvent.click(allow);
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it("an edit another card holds offers Await resolution first, then Go ahead", () => {
    const why = { holder: { id: "c2", title: "Other", claim: "f.ts" } } as never;
    renderCard({ column: "needs_you", pending: { ...pending, why } });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Await resolution", "Go ahead", "Deny"]));
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("Deny answers false", async () => {
    const { onAnswer } = renderCard({ column: "needs_you", pending });
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("questions get an Answer button that opens the card instead of Allow/Deny", async () => {
    const { onOpen } = renderCard({
      column: "needs_you",
      pending: { ...pending, questions: [{ question: "Which?", header: "Pick", options: [], multiSelect: false }] },
    });
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("a card waiting on you can be dragged; a running one can't", () => {
    const question = { ...pending, questions: [{ question: "Which?", header: "Pick", options: [], multiSelect: false }] };
    renderCard({ column: "needs_you", pending: question });
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")).toHaveAttribute("draggable", "true");
    cleanup();
    renderCard({ column: "running" });
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")).toHaveAttribute("draggable", "false");
  });

  it("outlines the card you opened last in ink, not unseen's accent, keeping unseen's tint and dot", () => {
    const frame = () => screen.getByText("Fix the login page").closest("[data-card-id]");
    renderCard({}, { lastOpen: true, unseen: true });
    expect(frame()).toHaveClass("card-last-open", "card-unseen");
    expect(frame()).not.toHaveClass("border-accent/70");
    expect(screen.getByTitle("New since you last looked")).toBeInTheDocument();
    cleanup();
    renderCard({}, { lastOpen: true, selected: true });
    expect(frame()).toHaveClass("border-accent");
    expect(frame()).not.toHaveClass("card-last-open");
  });

  it("a permission parked in Backlog still offers Allow and Deny", () => {
    renderCard({ column: "backlog", pending });
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
  });

  it("a running card has a Stop button that stops without opening", async () => {
    const { onStop, onOpen } = renderCard({ column: "running" });
    await userEvent.click(screen.getByRole("button", { name: "Stop this thread" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("an idle card has no Stop button", () => {
    renderCard({ column: "review" });
    expect(screen.queryByRole("button", { name: "Stop this thread" })).not.toBeInTheDocument();
  });

  it("a login prompt gets a Log in button that starts the CLI's login", async () => {
    renderCard({ column: "needs_you", lastLine: "Log in to Claude Code to continue" });
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(api.login).toHaveBeenCalledWith("claude", "start");
  });
});

describe("CardView star", () => {
  it("has a ☆ that stars the card without opening it", async () => {
    const onStar = vi.fn();
    const { onOpen } = renderCard({}, { onStar });
    await userEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(onStar).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows ★ on a starred card", () => {
    renderCard({ starred: true }, { onStar: vi.fn() });
    expect(screen.getByRole("button", { name: "Starred" })).toHaveTextContent("★");
  });

  it("has no star button without a handler", () => {
    renderCard({ starred: true });
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
  });
});

describe("CardView archive", () => {
  it("a Done card has an Archive button that calls onArchive without opening the card", async () => {
    const onArchive = vi.fn();
    const { onOpen } = renderCard({ column: "done" }, { onArchive });
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a Backlog card has an Archive button too", async () => {
    const onArchive = vi.fn();
    renderCard({ column: "backlog" }, { onArchive });
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("cards outside Backlog and Done don't get an Archive button", () => {
    renderCard({ column: "review" }, { onArchive: vi.fn() });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("an already-archived card gets an Unarchive button", async () => {
    const onArchive = vi.fn();
    renderCard({ column: "done", archived: true }, { onArchive });
    await userEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("has no archive button without a handler", () => {
    renderCard({ column: "done" });
    expect(screen.queryByRole("button", { name: /rchive/ })).not.toBeInTheDocument();
  });
});

describe("CardView copilot", () => {
  const copilot = { id: "copilot", role: "copilot" as const, title: "Copilot", column: "review" as const };

  it("says it runs the whole board instead of naming its folder", () => {
    renderCard(copilot);
    expect(screen.getByText("whole board")).toBeInTheDocument();
    expect(screen.queryByText("app")).not.toBeInTheDocument();
  });

  it("can't be dragged or starred", () => {
    renderCard(copilot, { onStar: vi.fn() });
    expect(screen.getByText("Copilot").closest("[data-card-id]")).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
  });

  it("opens on click", async () => {
    const { onOpen } = renderCard(copilot);
    await userEvent.click(screen.getByText("Copilot"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("CardView tags and issue", () => {
  it("shows two tags in the footer and +N for the rest", () => {
    renderCard({ tags: ["bug", "ui", "docs", "api"] });
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("ui")).toBeInTheDocument();
    expect(screen.queryByText("docs")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveAttribute("title", "docs, api");
  });

  it("a tag click filters the board without opening the card", async () => {
    const onTag = vi.fn();
    const { onOpen } = renderCard({ tags: ["bug"] }, { onTag });
    await userEvent.click(screen.getByRole("button", { name: "bug" }));
    expect(onTag).toHaveBeenCalledWith("bug");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("counts its running subagents in the footer", () => {
    const task = (id: string, status: "running" | "completed") => ({ id, kind: "agent" as const, description: `Audit ${id}`, status, startedAt: 0 });
    renderCard({ tasks: [task("a", "running"), task("b", "running"), task("c", "completed")] });
    expect(screen.getByText("⑂2")).toBeInTheDocument();
  });

  it("links the card's GitHub issue", () => {
    renderCard({ issue: { repo: "aimhuge/weft", number: 42, url: "https://github.com/aimhuge/weft/issues/42", state: "open", updatedAt: "" } });
    const link = screen.getByRole("link", { name: "#42" });
    expect(link).toHaveAttribute("href", "https://github.com/aimhuge/weft/issues/42");
    expect(link).toHaveAttribute("title", "aimhuge/weft#42 (open)");
  });

  it("shows nothing extra without tags or an issue", () => {
    renderCard();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });
});

describe("BackendBadge", () => {
  afterEach(cleanup);

  it("says the CLI until it knows the model", () => {
    render(<BackendBadge backend="puku" />);
    expect(screen.getByText("puku-cli")).toBeInTheDocument();
  });

  it("names the model and effort the CLI reported, or the card's own picks", () => {
    const runsOn = { model: "claude-opus-5-5", effort: "xhigh" as const };
    render(<BackendBadge backend="claude" card={makeCard({ stats: { runsOn } })} />);
    expect(screen.getByText("Opus 5.5 · xhigh")).toBeInTheDocument();
    cleanup();
    render(<BackendBadge backend="claude" card={makeCard({ model: "claude-fable-5-1", effort: "max", stats: { runsOn } })} />);
    expect(screen.getByText("Fable 5.1 · max")).toBeInTheDocument();
    cleanup();
    render(<BackendBadge backend="puku" card={makeCard({ backend: "puku", stats: { runsOn: { model: "puku-ai-2.8" } } })} />);
    expect(screen.getByText("Puku AI 2.8")).toBeInTheDocument();
  });
});
