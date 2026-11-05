// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardShareState } from "@/lib/share-types";
import { useEscape } from "@/lib/use-escape";
import { makeCard } from "./test-utils";

// The Share… dialog over the real @aimhuge/share UI, with the API, the account and the team page faked.

const api = vi.hoisted(() => ({ getShare: vi.fn(), setShare: vi.fn(), cloudSyncSetFolder: vi.fn() }));
const account = vi.hoisted(() => ({ signIn: vi.fn(), busy: null as string | null, waiting: null as object | null, error: null as string | null }));
const signedIn = vi.hoisted(() => ({ user: null as { id: string } | null }));
const openTeamPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client", () => ({ api }));
vi.mock("@/lib/use-account", () => ({ useAccount: () => ({ state: { kind: "ready", view: { configured: true, user: signedIn.user } }, ...account }) }));
vi.mock("./board-palette", () => ({ openTeamPage }));

const { default: ShareCardDialog } = await import("./ShareCardDialog");

const OK: CardShareState = { kind: "ok", id: null, url: null, mode: "private", hasPassword: false, slug: null, showChat: true };
const SHARED: CardShareState = { kind: "ok", id: "s1", url: "https://weft.zip/s/s1", mode: "email", hasPassword: false, slug: null, showChat: true };

function setup(...answers: CardShareState[]) {
  for (const a of answers) api.getShare.mockResolvedValueOnce(a);
  const onClose = vi.fn();
  render(<ShareCardDialog card={makeCard({ title: "Fix login" })} onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  Object.assign(account, { busy: null, waiting: null, error: null });
  signedIn.user = { id: "u1" };
  account.signIn.mockReset();
  openTeamPage.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("ShareCardDialog", () => {
  it("shows the access fields, the note and no link while the card is private", async () => {
    setup(OK);
    expect(await screen.findByRole("combobox", { name: "Who can open this thread" })).toHaveValue("private");
    expect(screen.getByRole("dialog", { name: "Share “Fix login”" })).toBeInTheDocument();
    expect(screen.getByText(/Key-shaped text is masked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "What link holders can do" })).not.toBeInTheDocument();
    expect(api.getShare).toHaveBeenCalledWith("c1");
  });

  it("opens the link on the email gate, saves it and offers the link twice", async () => {
    setup(OK);
    api.setShare.mockResolvedValueOnce(SHARED);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Who can open this thread" }), "link");
    expect(api.setShare).toHaveBeenCalledWith("c1", { mode: "email", password: undefined });
    expect(await screen.findAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
  });

  it("snaps back with the server's refusal", async () => {
    setup(SHARED);
    api.setShare.mockRejectedValueOnce(new Error("Set a password first."));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /What visitors hand over/ }), "none");
    expect(await screen.findByRole("alert")).toHaveTextContent("Set a password first.");
    api.setShare.mockResolvedValueOnce({ kind: "signed-out" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /What visitors hand over/ }), "none");
    expect(await screen.findByText("Sign in to Weft to share.")).toBeInTheDocument();
  });

  it("sends a password with the password gate", async () => {
    setup(SHARED);
    api.setShare.mockResolvedValueOnce({ ...SHARED, mode: "password", hasPassword: true });
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /What visitors hand over/ }), "password");
    expect(api.setShare).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole("textbox", { name: "Share password" }), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.setShare).toHaveBeenCalledWith("c1", { mode: "password", password: "pw" });
  });

  it("turns on sync for the card's folder, then asks again", async () => {
    setup({ kind: "not-synced", folder: "/Users/me/dev/app" }, OK);
    api.cloudSyncSetFolder.mockResolvedValueOnce({});
    expect(await screen.findByText(/uploaded unencrypted/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on sync for app" }));
    expect(api.cloudSyncSetFolder).toHaveBeenCalledWith("/Users/me/dev/app", true);
    expect(await screen.findByRole("combobox", { name: "Who can open this thread" })).toBeInTheDocument();
  });

  it("shows a failed sync switch", async () => {
    setup({ kind: "not-synced", folder: "/w" });
    api.cloudSyncSetFolder.mockRejectedValueOnce(new Error("No such folder."));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on sync for w" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No such folder.");
  });

  it("asks again every 2 s while the card uploads", async () => {
    vi.useFakeTimers();
    setup({ kind: "pending" }, OK);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText(/Uploading this card/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(api.getShare).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("combobox", { name: "Who can open this thread" })).toBeInTheDocument();
  });

  it("draws the card's remembered link at once, before the server answers", () => {
    api.getShare.mockReturnValueOnce(new Promise(() => {}));
    render(<ShareCardDialog card={makeCard({ share: { id: "s1", mode: "email", hasPassword: false } })} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Who can open this thread" })).toHaveValue("link");
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("draws private fields at once when the card remembers no share", () => {
    api.getShare.mockReturnValueOnce(new Promise(() => {}));
    render(<ShareCardDialog card={makeCard()} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Who can open this thread" })).toHaveValue("private");
  });

  it("draws the sign-in at once when signed out", () => {
    signedIn.user = null;
    api.getShare.mockReturnValueOnce(new Promise(() => {}));
    render(<ShareCardDialog card={makeCard({ share: { id: "s1", mode: "public", hasPassword: false } })} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });

  it("signs in with GitHub when signed out", async () => {
    account.error = "Sign-in failed.";
    setup({ kind: "signed-out" });
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    expect(account.signIn).toHaveBeenCalledWith("github");
    expect(screen.getByText("Sign-in failed.")).toBeInTheDocument();
  });

  it("shows sign-in in progress", async () => {
    account.waiting = { what: "GitHub" };
    setup({ kind: "signed-out" });
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeInTheDocument();
  });

  it("points at weft.zip/team without a workspace", async () => {
    setup({ kind: "no-workspace" });
    await userEvent.click(await screen.findByRole("button", { name: "weft.zip/team" }));
    expect(openTeamPage).toHaveBeenCalled();
  });

  it("shows a failed load", async () => {
    api.getShare.mockRejectedValueOnce("offline");
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("closes once on Escape, leaving Weft's panels open", async () => {
    const panel = vi.fn();
    function Panel() {
      useEscape(true, panel, { panel: true });
      return null;
    }
    api.getShare.mockResolvedValueOnce(OK);
    const onClose = vi.fn();
    render(
      <>
        <Panel />
        <ShareCardDialog card={makeCard()} onClose={onClose} />
      </>,
    );
    await screen.findByRole("combobox", { name: "Who can open this thread" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled();
    await waitFor(() => expect(api.getShare).toHaveBeenCalledTimes(1));
  });
});

describe("ShareCardDialog over the window", () => {
  it("draws on document.body and moves the browser pane aside while it's open", async () => {
    const { useAnyOverlay } = await import("@/lib/overlay");
    function Pane() {
      return <span data-testid="pane">{useAnyOverlay() ? "hidden" : "shown"}</span>;
    }
    api.getShare.mockResolvedValueOnce(OK);
    const { container, unmount } = render(
      <div>
        <Pane />
        <ShareCardDialog card={makeCard({ title: "Fix login" })} onClose={vi.fn()} />
      </div>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(screen.getByTestId("pane").textContent).toBe("hidden");
    unmount();
    render(<Pane />);
    expect(screen.getByTestId("pane").textContent).toBe("shown");
  });
});
