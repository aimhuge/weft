// @vitest-environment jsdom
// A worker's card open on the desktop board (components/ThreadPanel.tsx over lib/worker-transport.ts): its header offers
// the controls a worker's verbs back (rename, tags, star, archive, the model picker, the Skills menu, the review tour,
// Share… and delete when the board gives them) and nothing that only this Mac has (the skill set chip, crons, the dev
// server, the editor), and a pick goes out as a `host` command.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forget } from "@/lib/optimistic-cards";
import { PaneOpenContext } from "@/lib/pane-open";
import { ThreadTransportContext } from "@/lib/thread-transport";
import { workerTransport } from "@/lib/worker-transport";
import { makeCard } from "./test-utils";
import ThreadPanel from "./ThreadPanel";

const api = vi.hoisted(() => ({ skills: vi.fn(() => Promise.resolve({ skills: [] })), switchBackend: vi.fn(), schedule: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("./Composer", () => import("./composer-mock"));
vi.mock("@/lib/use-events", () => ({ useBoardEvents: () => {} }));
vi.mock("./ReviewPanelDevServer", () => ({ ReviewPanelDevServer: () => <p>dev server</p> }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock("@/lib/api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const card = makeCard({ cwd: "worker://w1/ling", backend: "claude", model: "claude-opus-5-5", tags: [] });

function renderWorkerPanel(shown = card, extra: { onShare?: () => void; onDelete?: () => void } = {}, openPage?: (url: string) => void) {
  const handlers = { onSend: vi.fn(() => Promise.resolve()), onAnswer: vi.fn(), onRename: vi.fn(), onMode: vi.fn(), onClose: vi.fn(), onStar: vi.fn(), onTags: vi.fn(), onArchive: vi.fn(), ...extra };
  render(
    <ThreadTransportContext.Provider value={workerTransport}>
      <PaneOpenContext.Provider value={openPage}>
        <ThreadPanel card={shown} items={[]} streaming="" {...handlers} />
      </PaneOpenContext.Provider>
    </ThreadTransportContext.Provider>,
  );
  return handlers;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url) => {
    if (url.startsWith("/api/workers")) return Promise.resolve(json({ status: "done", error: null }));
    if (url.startsWith("/api/worker-board?card=")) return Promise.resolve(json({ items: [], start: 0, total: 0 }));
    return Promise.resolve(json({ commandId: "cmd-1" }));
  });
});

afterEach(() => {
  forget(card.id);
  cleanup();
  vi.clearAllMocks();
});

describe("a worker card's header", () => {
  it("offers rename, tags, star, archive and the model picker", async () => {
    const { onRename, onTags, onArchive, onStar } = renderWorkerPanel();
    await userEvent.click(screen.getByRole("heading", { name: card.title }));
    const title = screen.getByDisplayValue(card.title);
    await userEvent.clear(title);
    await userEvent.type(title, "Fix it on m1mini{Enter}");
    expect(onRename).toHaveBeenCalledWith("Fix it on m1mini");
    await userEvent.click(screen.getByRole("button", { name: "Add a tag" }));
    expect(onTags).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Archive card" }));
    expect(onArchive).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /star/i }));
    expect(onStar).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Switch model/ })).toBeInTheDocument();
  });

  it("leaves out what only this Mac has (the skill set chip, crons, the editor), and delete and Share… when the board gives none", () => {
    renderWorkerPanel();
    expect(screen.queryByRole("button", { name: "Delete card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: /editor/i })).toBeNull();
    expect(screen.queryByTitle("Skills this thread gets")).toBeNull();
    expect(screen.queryByLabelText("Crons")).toBeNull();
  });

  it("offers the Skills menu, which sends /<skill> as a message", () => {
    renderWorkerPanel();
    expect(screen.getByTitle("Run a skill in this thread")).toBeInTheDocument();
  });

  it("offers Share… and delete, with the same confirm as a local card, when the board gives them", async () => {
    const onShare = vi.fn();
    const onDelete = vi.fn();
    renderWorkerPanel(card, { onShare, onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(onShare).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.getByTitle("Run a skill in this thread")).toBeInTheDocument();
  });

  it("leaves the header's marks to the pane's toolbar while the pane is open", () => {
    render(
      <ThreadTransportContext.Provider value={workerTransport}>
        <ThreadPanel card={card} items={[]} streaming="" onSend={vi.fn(() => Promise.resolve())} onAnswer={vi.fn()} onClose={vi.fn()} onArchive={vi.fn()} onShare={vi.fn()} marksInPane />
      </ThreadTransportContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive card" })).toBeNull();
  });

  it("sends a model pick to the worker as a host command, and never to this Mac", async () => {
    renderWorkerPanel();
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.7" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const posted = fetchMock.mock.calls.filter(([url, init]) => url === "/api/worker-board" && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);
    // The thread also reads its file index once (files.list, cached a minute per card) so file names link to the editor.
    expect(posted.filter((p) => (p as { verb?: string }).verb !== "files.list")).toEqual([{ action: "host", cardId: "c1", verb: "card.switchBackend", args: { id: "c1", backend: "puku", replay: false, model: "puku-ai-2.7" } }]);
    expect(api.switchBackend).not.toHaveBeenCalled();
  });
});

describe("a worker card's reply box", () => {
  it("keeps a ! command off the agent: the box turns amber and says a shell runs only on this Mac's cards", async () => {
    const { onSend } = renderWorkerPanel({ ...card, sessionId: "s-1" });
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "!git status{Enter}");
    expect(screen.getByText("A shell runs only on this Mac's cards.")).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    // Only the thread's file index read (files.list, H4) goes out; nothing that sends the message.
    const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as { verb?: string });
    expect(posted.filter((p) => p.verb !== "files.list")).toEqual([]);
  });

  it("offers Send later, and schedules on the worker that holds the timer, not this Mac", async () => {
    // A card with a session: one without starts fresh, which has no Send later (lib/reply-mode.ts).
    renderWorkerPanel({ ...card, sessionId: "s-1" });
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Run the nightly");
    await userEvent.click(screen.getByRole("button", { name: "More ways to send" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Send later/ }));
    await userEvent.click(screen.getByRole("button", { name: /In 1 hour/ }));
    const posted = fetchMock.mock.calls.filter(([url, init]) => url === "/api/worker-board" && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as { verb: string; args: { text: string; at: number } });
    expect(posted.filter((p) => p.verb !== "files.list")).toEqual([{ action: "host", cardId: "c1", verb: "card.schedule", args: { id: "c1", text: "Run the nightly", at: expect.any(Number) as number } }]);
    expect(api.schedule).not.toHaveBeenCalled();
  });
});

describe("a worker card's review tour", () => {
  const review = { url: "http://localhost:3000", dev: "pnpm dev", steps: [{ title: "Check the pricing page", path: "https://ling.example.com/pricing" }] };

  it("shows the tour's steps, puts each step's page in the card's own pane column, and leaves the dev server out", async () => {
    const browser = { open: vi.fn(() => Promise.resolve()), setVisible: vi.fn() };
    (window as unknown as { weft: unknown }).weft = { browser };
    const openPage = vi.fn();
    renderWorkerPanel({ ...card, column: "review", review }, {}, openPage);
    expect(await screen.findByText("Check the pricing page")).toBeInTheDocument();
    expect(openPage).toHaveBeenCalledWith("https://ling.example.com/pricing");
    await userEvent.click(screen.getByRole("button", { name: /Open browser/ }));
    expect(openPage).toHaveBeenCalledTimes(2);
    expect(browser.open).not.toHaveBeenCalled();
    expect(screen.queryByText("dev server")).toBeNull();
    delete (window as unknown as { weft?: unknown }).weft;
  });
});
