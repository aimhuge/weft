// @vitest-environment jsdom
// The weft.zip pane's sealed pages (components/web-board/useSealedPage.ts through WebPane): a browser with no key frames
// the route as before; a paired one shows nothing while it looks, then the opened page in srcdoc under the same sandbox,
// a file through its object URL, or the 🔒 note.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharePane } from "@/lib/share-types";
import type { SealedPage } from "@/lib/web-blob-open";

const keys = vi.hoisted(() => ({ ring: new Map<number, string>(), s: null as object | null }));
const opened = vi.hoisted(() => ({ next: Promise.resolve(null as SealedPage | null), calls: [] as unknown[][] }));
vi.mock("@/lib/web-sync-key", () => ({ webKeyring: () => keys.ring, webSodium: () => keys.s }));
vi.mock("@/lib/web-blob-open", () => ({ openSealedPage: (...args: unknown[]) => (opened.calls.push(args), opened.next) }));
vi.mock("./WorkerScreen", () => ({ WorkerScreen: () => null }));
const { WebPane } = await import("./WebPane");

const SHA = "a".repeat(64);
const blob: SharePane = { kind: "blob", ref: `blob:sha256:${SHA}`, hash: "", label: "Page" };
const frame = () => screen.queryByTitle("Card page");

afterEach(() => {
  cleanup();
  keys.ring = new Map();
  keys.s = null;
  opened.calls = [];
});

const paired = (page: SealedPage | null) => {
  keys.ring = new Map([[1, "k"]]);
  keys.s = {};
  opened.next = Promise.resolve(page);
};

describe("a sealed page in the pane", () => {
  it("frames the route as before in a browser with no key, and on the desktop board", () => {
    render(<WebPane orgId="org" pane={blob} />);
    expect(frame()?.getAttribute("src")).toBe(`/api/web-board/org/page/${SHA}`);
    paired({ kind: "locked" });
    cleanup();
    render(<WebPane orgId={null} pane={blob} />);
    expect(frame()?.getAttribute("src")).toBe(`/api/worker-board/page/${SHA}`);
    expect(opened.calls).toEqual([]);
  });

  it("shows the opened page through srcdoc, sandboxed", async () => {
    paired({ kind: "html", html: "<p>opened</p>" });
    render(<WebPane orgId="org" pane={blob} />);
    expect(frame()).toBeNull();
    await waitFor(() => expect(frame()?.getAttribute("srcdoc")).toBe("<p>opened</p>"));
    expect(frame()?.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-forms");
    expect(opened.calls[0]?.slice(0, 2)).toEqual(["org", SHA]);
  });

  it("frames a file's object URL, says when it won't open, and frames the route for a plain page", async () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    paired({ kind: "file", url: "blob:pdf" });
    const { unmount } = render(<WebPane orgId="org" pane={blob} />);
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe("blob:pdf"));
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:pdf");
    paired({ kind: "locked" });
    const second = render(<WebPane orgId="org" pane={blob} />);
    await waitFor(() => expect(screen.getByText(/Sealed — pair this browser/)).toBeTruthy());
    second.unmount();
    paired(null);
    render(<WebPane orgId="org" pane={blob} />);
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(`/api/web-board/org/page/${SHA}`));
  });
});
