// @vitest-environment jsdom
// The first-message-failed banner on the open thread (components/FirstMessageErrorBanner.tsx).
// Renders only when lib/first-message-failed.ts is true: card has an error, the card is not
// live, there's exactly one user message, and the assistant produced no useful text. The banner
// offers Rerun (api.rerunModel) and Delete (api.remove, through lib/optimistic-cards.ts). When no backup is configured the
// Rerun button opens Settings → Models through the openSettings prop.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirstMessageErrorBanner from "./FirstMessageErrorBanner";
import { api } from "@/lib/client";
import { rememberPage } from "@/lib/settings-nav";
import type { Card, ThreadItem } from "@/lib/types";
import "./test-utils";

vi.mock("@/lib/client", () => ({
  api: {
    settings: vi.fn(),
    rerunModel: vi.fn().mockResolvedValue({ card: {} }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock("@/lib/api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

vi.mock("@/lib/settings-nav", () => ({
  rememberPage: vi.fn(),
}));

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function failedThread(): ThreadItem[] {
  // One user message, then an error result. No assistant text — firstMessageFailed is true.
  return [
    { kind: "user", text: "first", at: 1 },
    { kind: "result", text: "rate limit", isError: true, at: 2 },
  ];
}

function goodThread(): ThreadItem[] {
  return [
    { kind: "user", text: "first", at: 1 },
    { kind: "assistant", text: "working on it", at: 2 },
    { kind: "result", text: "ok", isError: false, at: 3 },
  ];
}

beforeEach(() => {
  vi.mocked(api.settings).mockReset();
  vi.mocked(api.rerunModel).mockReset();
  vi.mocked(api.remove).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(rememberPage).mockReset();
  vi.mocked(api.settings).mockResolvedValue({ backupModel: "claude-sonnet-5-5" } as never);
});

describe("FirstMessageErrorBanner", () => {
  it("does not render when the card has no error", () => {
    const card = makeCard();
    const { container } = render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    expect(container.querySelector('[data-testid="first-message-error-banner"]')).toBeNull();
  });

  it("does not render when the assistant already produced text", () => {
    const card = makeCard({ error: "rate limit" });
    const { container } = render(<FirstMessageErrorBanner card={card} items={goodThread()} />);
    expect(container.querySelector('[data-testid="first-message-error-banner"]')).toBeNull();
  });

  it("does not render on a live card (thread still running)", () => {
    const card = makeCard({ error: "rate limit", column: "running" });
    const { container } = render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    expect(container.querySelector('[data-testid="first-message-error-banner"]')).toBeNull();
  });

  it("does not render when there is no user message", () => {
    const card = makeCard({ error: "rate limit" });
    const { container } = render(<FirstMessageErrorBanner card={card} items={[]} />);
    expect(container.querySelector('[data-testid="first-message-error-banner"]')).toBeNull();
  });

  it("renders when firstMessageFailed is true and shows the error text", async () => {
    const card = makeCard({ error: "You've hit your plan limit" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    expect(await screen.findByTestId("first-message-error-banner")).toBeInTheDocument();
    expect(screen.getByText("You've hit your plan limit")).toBeInTheDocument();
  });

  it("with a backup model set, the Rerun button calls api.rerunModel with the saved model", async () => {
    const card = makeCard({ error: "rate limit" });
    const onDeleted = vi.fn();
    render(
      <FirstMessageErrorBanner card={card} items={failedThread()} openSettings={() => {}} onDeleted={onDeleted} />,
    );
    const button = await screen.findByRole("button", { name: /Rerun on Sonnet 5\.5/ });
    fireEvent.click(button);
    await waitFor(() => {
      expect(api.rerunModel).toHaveBeenCalledWith("card-1", "claude-sonnet-5-5");
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("on a worker's card, reruns on the backup model your Settings sync to it, on the worker", async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    fetchMock.mockImplementation((url) => Promise.resolve(json(url.startsWith("/api/workers") ? { status: "done", error: null } : { commandId: "cmd-1" })));
    const card = makeCard({ id: "w-card", cwd: "worker://w1/ling", error: "rate limit", backend: "claude", model: "claude-fable-5-1" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} openSettings={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rerun on Sonnet 5\.5/ }));
    await waitFor(() => {
      const posted = fetchMock.mock.calls.filter(([url, init]) => url === "/api/worker-board" && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);
      expect(posted).toEqual([{ action: "host", cardId: "w-card", verb: "card.rerunModel", args: { id: "w-card", model: "claude-sonnet-5-5" } }]);
    });
    expect(api.rerunModel).not.toHaveBeenCalled();
  });

  it("on a worker's card with no Settings to read (weft.zip), reruns on its own CLI's default", () => {
    const card = makeCard({ id: "w-card", cwd: "worker://w1/ling", error: "rate limit", backend: "claude", model: "claude-fable-5-2" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    expect(screen.getByRole("button", { name: "Rerun on Opus 5.5" })).toBeInTheDocument();
    expect(api.settings).not.toHaveBeenCalled();
  });

  it("with no backup configured, the Rerun button is 'Pick a backup model' and opens Settings", async () => {
    vi.mocked(api.settings).mockResolvedValue({ backupModel: "" } as never);
    const card = makeCard({ error: "rate limit" });
    const openSettings = vi.fn();
    render(<FirstMessageErrorBanner card={card} items={failedThread()} openSettings={openSettings} />);
    const button = await screen.findByRole("button", { name: "Pick a backup model" });
    fireEvent.click(button);
    expect(rememberPage).toHaveBeenCalledWith("models");
    expect(openSettings).toHaveBeenCalled();
    expect(api.rerunModel).not.toHaveBeenCalled();
  });

  it("with no openSettings (weft.zip) reads no settings and offers no rerun, only the error", async () => {
    const card = makeCard({ error: "rate limit" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    await screen.findByTestId("first-message-error-banner");
    expect(api.settings).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Pick a backup model|Rerun on/ })).toBeNull();
  });

  it("offers no Delete where the card's host has no delete verb (weft.zip's host for every card)", async () => {
    const { setHostForEveryCard } = await import("@/lib/project-host");
    const { webHost } = await import("@/lib/web-host");
    const undo = setHostForEveryCard(webHost({ act: vi.fn() }, { desktop: false } as never, vi.fn()));
    render(<FirstMessageErrorBanner card={makeCard({ error: "rate limit" })} items={failedThread()} />);
    await screen.findByTestId("first-message-error-banner");
    expect(screen.queryByRole("button", { name: "Delete this card" })).toBeNull();
    undo();
  });

  it("Delete calls api.remove and the parent's onDeleted", async () => {
    const card = makeCard({ error: "rate limit" });
    const onDeleted = vi.fn();
    render(<FirstMessageErrorBanner card={card} items={failedThread()} onDeleted={onDeleted} />);
    await screen.findByTestId("first-message-error-banner");
    fireEvent.click(screen.getByRole("button", { name: "Delete this card" }));
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith("card-1");
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it("Delete still works without an onDeleted callback", async () => {
    const card = makeCard({ error: "rate limit" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} />);
    await screen.findByTestId("first-message-error-banner");
    fireEvent.click(screen.getByRole("button", { name: "Delete this card" }));
    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith("card-1");
    });
  });

  it("shows an error message if Rerun fails", async () => {
    vi.mocked(api.rerunModel).mockRejectedValue(new Error("network down"));
    const card = makeCard({ error: "rate limit" });
    render(<FirstMessageErrorBanner card={card} items={failedThread()} openSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rerun on/ }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
  });

  it("only fetches settings when the banner is visible (the predicate is true)", () => {
    // Healthy thread: banner never renders, so settings is never read.
    const card = makeCard();
    render(<FirstMessageErrorBanner card={card} items={goodThread()} />);
    expect(api.settings).not.toHaveBeenCalled();
  });
});
