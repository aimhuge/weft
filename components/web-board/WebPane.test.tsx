// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WebPane } from "./WebPane";
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

  it("says when nothing's open", () => {
    render(<WebPane orgId="org" pane={null} />);
    expect(screen.getByText("No page open in this card's browser pane.")).toBeTruthy();
  });
});
