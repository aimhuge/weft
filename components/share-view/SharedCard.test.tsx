// @vitest-environment jsdom
// components/share-view/SharedCard.tsx: the /s/[id] viewer's two halves. The pane kinds (blob,
// site, local, none) and the poll merge are the interesting branches; a click on "Load earlier"
// fires a poll that appends to the window.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "@/components/test-utils";
import { SHARE_POLL_MS, type ShareLive } from "@/lib/share-types";
import type { Card } from "@/lib/types";
import { SharedCard } from "./SharedCard";

const SHA = "a".repeat(64);
const REF = `blob:sha256:${SHA}` as const;

function makeLive(over: Partial<ShareLive> = {}): ShareLive {
  const card: Card = { ...makeCard({ id: "c1", column: "review" }) };
  return {
    card,
    items: [],
    hasOlder: false,
    pane: null,
    blobUrls: {},
    showChat: true,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as typeof fetch;
  // The viewer is a "visible" tab while jsdom is in the test.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SharedCard's chat", () => {
  it("shows the pane alone when the sharer hid the chat", () => {
    render(<SharedCard id="sh1" initial={makeLive({ showChat: false })} />);
    expect(screen.queryByRole("region", { name: "Thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide chat" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "View" })).toBeNull();
    expect(screen.getByRole("region", { name: "Browser pane" })).toHaveAttribute("data-hidden", "false");
  });

  it("lets the viewer hide and show the chat", async () => {
    render(<SharedCard id="sh1" initial={makeLive()} />);
    const main = document.querySelector(".wz-shareMain");
    expect(main).toHaveAttribute("data-chat", "open");
    await userEvent.click(screen.getByRole("button", { name: "Hide chat" }));
    expect(main).toHaveAttribute("data-chat", "closed");
    await userEvent.click(screen.getByRole("button", { name: "Show chat" }));
    expect(main).toHaveAttribute("data-chat", "open");
  });
});

describe("SharedCard", () => {
  it("renders the title, the column chip and the live dot", () => {
    render(<SharedCard id="sh1" initial={makeLive({ card: { ...makeCard({ id: "c1", title: "Hello", column: "review" }) } })} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders nothing in the pane when there is no pane and no thumb", () => {
    render(<SharedCard id="sh1" initial={makeLive()} />);
    expect(screen.getByText("No page open")).toBeInTheDocument();
    expect(screen.getByText("No pane capture yet.")).toBeInTheDocument();
  });

  it("frames a blob pane with the sandboxed iframe src", () => {
    const live = makeLive({
      pane: { kind: "blob", ref: REF, hash: "#step", label: "Plan" },
      blobUrls: { [REF]: "https://signed/blob" },
    });
    render(<SharedCard id="sh1" initial={live} />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(`/api/s/sh1/page/${SHA}#step`);
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-forms");
  });

  it("frames a site pane and offers an 'Open ↗' link", () => {
    const live = makeLive({ pane: { kind: "site", url: "https://example.com/docs/", label: "example.com/docs" } });
    render(<SharedCard id="sh1" initial={live} />);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe("https://example.com/docs/");
    const openLink = screen.getByRole("link", { name: /Open/ });
    expect(openLink.getAttribute("href")).toBe("https://example.com/docs/");
  });

  it("shows the thumb as the pane for a local pane, with a quiet note", () => {
    const card: Card = { ...makeCard({ id: "c1", thumb: REF }) };
    const live = makeLive({
      card,
      pane: { kind: "local", url: "http://localhost:3000/x", label: "x" },
      blobUrls: { [REF]: "https://signed/thumb" },
    });
    render(<SharedCard id="sh1" initial={live} />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://signed/thumb");
    expect(screen.getByText("Running on the owner's Mac: x")).toBeInTheDocument();
  });

  it("switches to the pane on a phone-width view via the toggle", async () => {
    const live = makeLive({ pane: { kind: "site", url: "https://example.com/", label: "example.com" } });
    render(<SharedCard id="sh1" initial={live} />);
    const paneBtn = screen.getByRole("tab", { name: "Page" });
    await userEvent.click(paneBtn);
    expect(paneBtn.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Thread" }).getAttribute("aria-selected")).toBe("false");
  });

  it("merges a poll response into the live state", async () => {
    // Real timers + the poll's own setTimeout — the visible-tab branch fires the first tick after
    // SHARE_POLL_MS, then resolves the fetch + state update on the microtask queue.
    const initial = makeLive({
      items: [{ seq: 1, item: { kind: "user", text: "old", at: 1 } }],
    });
    const next = makeLive({
      items: [{ seq: 2, item: { kind: "user", text: "new", at: 2 } }],
    });
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(next) });
    render(<SharedCard id="sh1" initial={initial} />);
    // Wait past the first poll: setTimeout fires at SHARE_POLL_MS, then the .then merge.
    await new Promise((r) => setTimeout(r, SHARE_POLL_MS + 200));
    expect(await screen.findByText("new")).toBeInTheDocument();
  }, 10_000);

  it("marks the live dot offline when the poll fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<SharedCard id="sh1" initial={makeLive()} />);
    await waitFor(() => {
      expect(screen.getByText("Offline")).toBeInTheDocument();
    }, { timeout: SHARE_POLL_MS + 1000 });
  });

  it("hides 'Load earlier' when hasOlder is false", () => {
    render(<SharedCard id="sh1" initial={makeLive({ hasOlder: false, items: [{ seq: 1, item: { kind: "user", text: "x", at: 1 } }] })} />);
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("fetches with ?before= when 'Load earlier' is clicked", async () => {
    const older = makeLive({
      hasOlder: true,
      items: [
        { seq: 11, item: { kind: "user", text: "newer one", at: 11 } },
        { seq: 10, item: { kind: "user", text: "older one", at: 10 } },
      ],
    });
    const before = makeLive({ items: [{ seq: 9, item: { kind: "user", text: "much older", at: 9 } }] });
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(before) });
    render(<SharedCard id="sh1" initial={older} />);
    await userEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/s/sh1/live?before=9`, expect.objectContaining({ cache: "no-store" }));
    });
    await waitFor(() => {
      expect(screen.getByText("much older")).toBeInTheDocument();
    });
  });
});
