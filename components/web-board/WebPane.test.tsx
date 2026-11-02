// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebPane } from "./WebPane";

// The live screen draws over Realtime and WebRTC; these tests are about the pane around it.
vi.mock("./WorkerScreen", () => ({ WorkerScreen: () => null }));
import type { SharePane } from "@/lib/share-types";

const SHA = "a".repeat(64);
const blob: SharePane = { kind: "blob", ref: `blob:sha256:${SHA}`, hash: "#step-2", label: "Page" };
const site: SharePane = { kind: "site", url: "https://example.com/a", label: "example.com/a" };
afterEach(cleanup);

const frame = () => screen.queryByTitle("Card page");

describe("WebPane", () => {
  it("frames a page through the web board's route on weft.zip", () => {
    render(<WebPane orgId="org" pane={blob} />);
    expect(frame()?.getAttribute("src")).toBe(`/api/web-board/org/page/${SHA}#step-2`);
    expect(frame()?.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-forms");
  });

  it("frames a page through this Mac's server on the desktop board, with scripts only", () => {
    render(<WebPane orgId={null} pane={blob} />);
    expect(frame()?.getAttribute("src")).toBe(`/api/worker-board/page/${SHA}#step-2`);
    expect(frame()?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("frames a public site on the web, but not in the board window's session", () => {
    const { unmount } = render(<WebPane orgId="org" pane={site} />);
    expect(frame()?.getAttribute("src")).toBe(site.url);
    unmount();
    render(<WebPane orgId={null} pane={site} />);
    expect(frame()).toBeNull();
    expect(screen.getByText("Open ↗").getAttribute("href")).toBe(site.url);
  });

  it("names no particular machine for a page that couldn't go up", () => {
    render(<WebPane orgId={null} pane={{ kind: "local", url: "file:///x.html", label: "x.html" }} />);
    expect(screen.getByText("This page only exists on the machine running this card.")).toBeTruthy();
  });

  it("shows the proxied url a saved page is framed from, and a site's own url", () => {
    const { unmount } = render(<WebPane orgId={null} pane={blob} />);
    const field = () => screen.getByLabelText<HTMLInputElement>("Page address");
    expect(field().value).toBe(`${window.location.origin}/api/worker-board/page/${SHA}#step-2`);
    unmount();
    const web = render(<WebPane orgId="org" pane={blob} />);
    expect(field().value).toBe(`${window.location.origin}/api/web-board/org/page/${SHA}#step-2`);
    web.unmount();
    render(<WebPane orgId="org" pane={site} />);
    expect(field().value).toBe(site.url);
  });

  it("says when nothing's open", () => {
    render(<WebPane orgId="org" pane={null} />);
    expect(screen.getByText("No page open in this card's browser pane.")).toBeTruthy();
  });

  it("starts a mobile app's simulator from the empty pane, and from the host chip over another page", async () => {
    const onScreenInput = vi.fn(() => Promise.resolve());
    const { rerender } = render(<WebPane orgId={null} pane={null} onScreenInput={onScreenInput} mobileApp source="m1mini" />);
    fireEvent.click(screen.getByRole("button", { name: /Start simulator/ }));
    expect(onScreenInput).toHaveBeenCalledWith({ kind: "watch" });
    expect(screen.getByRole("button", { name: /Starting simulator/ })).toBeTruthy();
    const failing = vi.fn(() => Promise.reject(new Error("no simulators")));
    rerender(<WebPane orgId={null} pane={blob} onScreenInput={failing} mobileApp source="m1mini" />);
    fireEvent.click(screen.getByRole("button", { name: "m1mini" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Start simulator/ }));
    expect(failing).toHaveBeenCalledWith({ kind: "watch" });
    await waitFor(() => expect(screen.getByRole("button", { name: "m1mini ⚠" }).getAttribute("title")).toBe("no simulators"));
  });

  it("names the worker and its simulator over the live screen", () => {
    const live: SharePane = { kind: "screen", url: "weft-screen://x", token: "t", device: "udid-w", label: "iPhone 16", devices: [], until: Date.now() + 60_000, fast: false };
    render(<WebPane orgId="org" pane={live} source="m1mini" />);
    expect(screen.getByRole("button", { name: "m1mini + simulator" })).toBeTruthy();
  });

  it("says why the empty pane couldn't start one", async () => {
    render(<WebPane orgId={null} pane={null} onScreenInput={vi.fn(() => Promise.reject(new Error("worker offline")))} mobileApp />);
    fireEvent.click(screen.getByRole("button", { name: /Start simulator/ }));
    await waitFor(() => expect(screen.getByText("worker offline")).toBeTruthy());
  });

  it("offers no Start simulator outside a mobile app, or where the board can't drive the worker", () => {
    const { rerender } = render(<WebPane orgId={null} pane={null} onScreenInput={vi.fn(() => Promise.resolve())} />);
    expect(screen.queryByRole("button", { name: /Start simulator/ })).toBeNull();
    rerender(<WebPane orgId="org" pane={blob} mobileApp />);
    expect(screen.queryByRole("button", { name: /Start simulator/ })).toBeNull();
    // Nothing host-specific to say there, so no host chip either.
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
  });
});
