// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { AppShareState } from "@/lib/app-share-types";
import type { MiniApp } from "@/lib/mini-apps";

// The browser pane's Share button for a saved app (components/BrowserPane.tsx). Renders nothing when
// the page isn't a saved app, opens the share dialog through guarded() when clicked, and tints itself
// accent once the app has a link.

const getShare = vi.fn<() => Promise<AppShareState>>();
vi.mock("@/lib/use-mini-apps", () => ({
  appsApi: { getShare, setShare: vi.fn() },
  reloadApps: vi.fn(() => Promise.resolve()),
}));

const { default: AppShareButton } = await import("./AppShareButton");

const APP: MiniApp = { id: "ap1", name: "📈 Growth", url: "file:///Users/me/.weft/apps/growth/index.html", addedAt: 1 };

beforeEach(() => {
  getShare.mockReset();
  getShare.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  // Dialogs mount under document.body via a portal; cleanup() in test-utils unmounts React
  // before the next test, so leave body alone here.
});

describe("AppShareButton", () => {
  it("renders nothing when the page isn't a saved app", () => {
    const { container } = render(<AppShareButton app={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a muted share button for an unlinked app", () => {
    render(<AppShareButton app={APP} />);
    const button = screen.getByRole("button", { name: "Share app" });
    expect(button).toHaveAttribute("title", "Share this app");
    expect(button.className).toContain("text-muted");
    expect(button.className).not.toContain("text-accent");
  });

  it("tints accent when the app already has a link", () => {
    render(<AppShareButton app={{ ...APP, share: { id: "s1", mode: "public", hasPassword: false } }} />);
    const button = screen.getByRole("button", { name: "Share app" });
    expect(button.className).toContain("text-accent");
    expect(button).toHaveAttribute("title", "This app has a weft.zip link");
  });

  it("opens the share dialog when clicked and fetches the app's state", async () => {
    getShare.mockResolvedValueOnce({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "blob", owner: "user", slug: null, orgId: null, publicUrl: null, owners: { user: { username: "alice" }, orgs: [] }, manifest: null, preview: null, previewing: false });
    render(<AppShareButton app={APP} />);
    fireEvent.click(screen.getByRole("button", { name: "Share app" }));
    await waitFor(() => expect(getShare).toHaveBeenCalledWith("ap1"));
    // The dialog mounts as a portal under document.body; ShareDialog draws a dialog role.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes the dialog when the dialog's onClose fires", async () => {
    getShare.mockResolvedValueOnce({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "blob", owner: "user", slug: null, orgId: null, publicUrl: null, owners: { user: null, orgs: [] }, manifest: null, preview: null, previewing: false });
    render(<AppShareButton app={APP} />);
    fireEvent.click(screen.getByRole("button", { name: "Share app" }));
    await screen.findByRole("dialog");
    const close = document.querySelector<HTMLElement>('[aria-label="Close"]');
    expect(close).toBeTruthy();
    fireEvent.click(close!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
