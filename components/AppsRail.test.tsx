// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { MiniApp } from "@/lib/mini-apps";
import AppsRail from "./AppsRail";
import SaveAppButton from "./SaveAppButton";

// The rail's mini apps (AppsRail) and the pane's Save as app (SaveAppButton). The hook returns a
// list we control, the appActions mock captures save/rename/move/remove, and the desktop
// bridge's popupMenu is wired per test (so the right-click menu's branch is exercised).

const apps: MiniApp[] = [
  { id: "a", name: "Docs", url: "https://docs.test/home", addedAt: 1 },
  { id: "b", name: "🚀 Launch", url: "https://launch.test", addedAt: 2 },
  { id: "c", name: "GitHub", url: "https://github.test/o/r", addedAt: 3 },
];

const appActions = vi.hoisted(() => ({
  save: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  move: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
}));
const shareAppDialogProps = vi.hoisted(() => ({ current: null as { app: MiniApp; onClose: () => void } | null }));
vi.mock("@/lib/use-mini-apps", () => ({
  useMiniApps: vi.fn(() => []),
  appActions,
  reloadApps: vi.fn(() => Promise.resolve()),
  resetMiniApps: vi.fn(),
}));
vi.mock("./ShareAppDialog", () => ({
  default: (props: { app: MiniApp; onClose: () => void }) => {
    shareAppDialogProps.current = props;
    return (
      <div role="dialog" aria-label={`Share “${props.app.name}”`}>
        <button type="button" onClick={props.onClose}>Close</button>
      </div>
    );
  },
}));
import { useMiniApps } from "@/lib/use-mini-apps";

const writeText = vi.fn(() => Promise.resolve());

function setApps(next: MiniApp[]) {
  (useMiniApps as unknown as { mockReturnValue(next: MiniApp[]): void }).mockReturnValue(next);
}

beforeEach(() => {
  appActions.save.mockReset().mockResolvedValue(undefined);
  appActions.rename.mockReset().mockResolvedValue(undefined);
  appActions.move.mockReset().mockResolvedValue(undefined);
  appActions.remove.mockReset().mockResolvedValue(undefined);
  shareAppDialogProps.current = null;
  setApps([]);
  delete (window as unknown as { weft?: unknown }).weft;
  // happy-dom's navigator.clipboard is not implemented; the right-click "Copy address" branch needs it.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("AppsRail", () => {
  it("renders nothing when there are no apps", () => {
    const { container } = render(<AppsRail onOpen={vi.fn()} onClose={vi.fn()} notify={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a tile per app with a glyph and aria-label, and a click opens the url", async () => {
    setApps(apps);
    const onOpen = vi.fn();
    render(<AppsRail onOpen={onOpen} onClose={vi.fn()} notify={vi.fn()} />);
    const docs = screen.getByRole("button", { name: "Docs" });
    expect(docs).toHaveTextContent("D");
    const rocket = screen.getByRole("button", { name: "🚀 Launch" });
    expect(rocket).toHaveTextContent("🚀");
    await userEvent.click(docs);
    expect(onOpen).toHaveBeenCalledWith("https://docs.test/home");
  });

  it("marks the active tile aria-pressed=true and the rest aria-pressed=false", () => {
    setApps(apps);
    render(<AppsRail current="https://launch.test" onOpen={vi.fn()} onClose={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: "🚀 Launch" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Docs" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "GitHub" })).toHaveAttribute("aria-pressed", "false");
  });

  it("right-clicks into the desktop menu and runs each action through appActions", async () => {
    setApps(apps);
    const popupMenu = vi.fn().mockResolvedValueOnce("rename").mockResolvedValueOnce("up").mockResolvedValueOnce("down").mockResolvedValueOnce("copy").mockResolvedValueOnce("remove").mockResolvedValueOnce("open").mockResolvedValueOnce(null);
    (window as unknown as { weft: { popupMenu: typeof popupMenu } }).weft = { popupMenu };
    const onOpen = vi.fn();
    const notify = vi.fn();
    render(<AppsRail onOpen={onOpen} onClose={vi.fn()} notify={notify} />);

    // Right-click on the middle app (GitHub, index 2). The first right-click picks "rename".
    const github = screen.getByRole("button", { name: "GitHub" });
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(1));
    // A rename input shows next to the tile.
    const renameInput = await screen.findByLabelText("Rename GitHub");
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Hub{Enter}");
    expect(appActions.rename).toHaveBeenCalledWith("c", "Hub");
    // Re-open the menu and pick up/down/copy/remove/open for the same app.
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(2));
    expect(appActions.move).toHaveBeenCalledWith("c", 1); // index 2 - 1
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(3));
    expect(appActions.move).toHaveBeenCalledWith("c", 3); // index 2 + 1
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(4));
    expect(writeText).toHaveBeenCalledWith("https://github.test/o/r");
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(5));
    expect(appActions.remove).toHaveBeenCalledWith("c");
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(6));
    expect(onOpen).toHaveBeenCalledWith("https://github.test/o/r");
    // A null pick (menu dismissed) does nothing.
    await userEvent.pointer({ keys: "[MouseRight]", target: github });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(7));
    expect(appActions.remove).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the desktop bridge has no popupMenu", async () => {
    setApps(apps);
    render(<AppsRail onOpen={vi.fn()} onClose={vi.fn()} notify={vi.fn()} />);
    const docs = screen.getByRole("button", { name: "Docs" });
    await userEvent.pointer({ keys: "[MouseRight]", target: docs });
    // The appActions are still untouched.
    expect(appActions.remove).not.toHaveBeenCalled();
    expect(appActions.rename).not.toHaveBeenCalled();
  });

  it("Escape on the rename input drops the change", async () => {
    setApps(apps);
    const popupMenu = vi.fn().mockResolvedValueOnce("rename");
    (window as unknown as { weft: { popupMenu: typeof popupMenu } }).weft = { popupMenu };
    render(<AppsRail onOpen={vi.fn()} onClose={vi.fn()} notify={vi.fn()} />);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "GitHub" }) });
    const input = await screen.findByLabelText("Rename GitHub");
    await userEvent.clear(input);
    await userEvent.type(input, "Hub{Escape}");
    expect(appActions.rename).not.toHaveBeenCalled();
  });

  it("a click on the active tile closes the browser instead of re-opening", async () => {
    setApps(apps);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<AppsRail current="https://launch.test" onOpen={onOpen} onClose={onClose} notify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "🚀 Launch" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a click on a non-active tile still opens it", async () => {
    setApps(apps);
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<AppsRail current="https://launch.test" onOpen={onOpen} onClose={onClose} notify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onOpen).toHaveBeenCalledWith("https://docs.test/home");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the right-click menu's 'open' on an active app closes the browser", async () => {
    setApps(apps);
    const popupMenu = vi.fn().mockResolvedValueOnce("open");
    (window as unknown as { weft: { popupMenu: typeof popupMenu } }).weft = { popupMenu };
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<AppsRail current="https://launch.test" onOpen={onOpen} onClose={onClose} notify={vi.fn()} />);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "🚀 Launch" }) });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("the right-click menu's 'open' on a non-active app still opens it", async () => {
    setApps(apps);
    const popupMenu = vi.fn().mockResolvedValueOnce("open");
    (window as unknown as { weft: { popupMenu: typeof popupMenu } }).weft = { popupMenu };
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<AppsRail current="https://launch.test" onOpen={onOpen} onClose={onClose} notify={vi.fn()} />);
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Docs" }) });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith("https://docs.test/home");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the share dialog when the right-click menu picks 'share'", async () => {
    setApps(apps);
    const popupMenu = vi.fn().mockResolvedValueOnce("share");
    (window as unknown as { weft: { popupMenu: typeof popupMenu } }).weft = { popupMenu };
    render(<AppsRail onOpen={vi.fn()} onClose={vi.fn()} notify={vi.fn()} />);
    expect(shareAppDialogProps.current).toBeNull();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Docs" }) });
    await waitFor(() => expect(popupMenu).toHaveBeenCalledTimes(1));
    expect(shareAppDialogProps.current).not.toBeNull();
    expect(shareAppDialogProps.current?.app).toMatchObject({ id: "a", name: "Docs" });
    expect(screen.getByRole("dialog", { name: /Share “Docs”/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /Share “Docs”/ })).not.toBeInTheDocument();
  });
});

describe("SaveAppButton", () => {
  it("is disabled and unpressed when the URL can't be saved (about:blank)", () => {
    setApps([]);
    render(<SaveAppButton url="about:blank" title="Blank" notify={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Save as app" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("saves the page with a name derived from the title and url", async () => {
    setApps([]);
    render(<SaveAppButton url="https://example.com/foo" title="My Page" notify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save as app" }));
    expect(appActions.save).toHaveBeenCalledWith("https://example.com/foo", "My Page");
  });

  it("saves a worker card's page by its blob, and is lit once that page is an app", async () => {
    const page = `blob:sha256:${"d".repeat(64)}`;
    setApps([]);
    const { unmount } = render(<SaveAppButton url={page} title="Burndown" notify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save as app" }));
    expect(appActions.save).toHaveBeenCalledWith(page, "Burndown");
    unmount();
    setApps([{ id: "w", name: "Burndown", url: "file:///Users/me/.weft/apps/worker-dddd/index.html", source: page, addedAt: 4 }]);
    render(<SaveAppButton url={page} title="Burndown" notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove from apps" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to the URL's name when no title is given", async () => {
    setApps([]);
    render(<SaveAppButton url="https://example.com/foo" title="" notify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save as app" }));
    expect(appActions.save).toHaveBeenCalledWith("https://example.com/foo", "example.com");
  });

  it("is pressed and removes when the URL is already an app", async () => {
    setApps(apps);
    render(<SaveAppButton url="https://launch.test" title="Anything" notify={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Remove from apps" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    expect(appActions.remove).toHaveBeenCalledWith("b");
  });

  it("reports a failed save through the notify callback", async () => {
    setApps([]);
    appActions.save.mockRejectedValueOnce(new Error("nope"));
    const notify = vi.fn();
    render(<SaveAppButton url="https://example.com" title="X" notify={notify} />);
    await userEvent.click(screen.getByRole("button", { name: "Save as app" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("nope")));
  });
});