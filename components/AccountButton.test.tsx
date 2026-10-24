// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingClientView } from "@/lib/client";
import type { AccountView } from "@/lib/types";
import { resetBillingStatus } from "@/lib/use-billing-status";
import { closeUpgrade, useUpgradeReason } from "@/lib/use-upgrade";
import "./test-utils";
import AccountButton from "./AccountButton";

const api = vi.hoisted(() => ({
  account: vi.fn<() => Promise<AccountView>>(),
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth" })),
  magicLink: vi.fn(),
  signOut: vi.fn(),
  billingStatus: vi.fn<() => Promise<BillingClientView>>(() => Promise.resolve(null)),
}));
vi.mock("@/lib/client", () => ({ api }));

const useTeamPrefetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/use-team", () => ({ useTeamPrefetch }));

const openExternal = vi.fn();
const browserOpen = vi.fn(() => Promise.resolve());
const billing = {
  org: { slug: "acme", name: "Acme Labs" },
  plan: { id: "pro" as const, name: "Pro" },
  status: "active",
  interval: "monthly" as const,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  puku: null,
  manageUrl: "https://weft.zip/acme/billing",
};
const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: "https://img/ada.png", provider: "github" };

function setup() {
  const onOpenSettings = vi.fn();
  const view = render(<AccountButton onOpenSettings={onOpenSettings} />);
  return { onOpenSettings, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBillingStatus();
  // The pane path and the system-browser path both stub the shell bridge; specific tests
  // overwrite `window.weft` to exercise each branch.
  window.weft = { openExternal, browser: { open: browserOpen } } as unknown as typeof window.weft;
});

describe("AccountButton", () => {
  it("prefetches the team once you're signed in, so Settings → Team opens loaded", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    await vi.waitFor(() => expect(useTeamPrefetch).toHaveBeenLastCalledWith("u1"));
  });

  it("doesn't prefetch a team while signed out", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    setup();
    await screen.findByRole("button", { name: "Sign in with GitHub" });
    expect(useTeamPrefetch).toHaveBeenLastCalledWith(undefined);
  });

  it("takes no room until it knows, or when accounts aren't set up", async () => {
    api.account.mockResolvedValue({ configured: false, user: null });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(api.account).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("signs in with GitHub in the system browser", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    setup();
    const button = await screen.findByRole("button", { name: "Sign in with GitHub" });
    expect(button).toHaveTextContent("Sign in");
    await userEvent.click(button);
    expect(api.signIn).toHaveBeenCalledWith("github", "/");
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/oauth");
    expect(button).toHaveTextContent("Signing in…");
    expect(button).toHaveAttribute("title", "Finish signing in with GitHub in your browser");
  });

  it("shows a failed sign-in in its tooltip", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    api.signIn.mockRejectedValueOnce(new Error("GitHub sign-in is off"));
    setup();
    const button = await screen.findByRole("button", { name: "Sign in with GitHub" });
    await userEvent.click(button);
    expect(button).toHaveAttribute("title", "GitHub sign-in is off");
  });

  it("shows your avatar once signed in, with Settings and Your team behind it", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const { onOpenSettings } = setup();
    const avatar = await screen.findByRole("button", { name: "Signed in as Ada" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", "https://img/ada.png");
    // No menu until the avatar is clicked; opening Settings is a second click.
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(avatar);
    const settings = await screen.findByRole("menuitem", { name: /Settings/ });
    const team = screen.getByRole("menuitem", { name: /Your team/ });
    expect(team).toHaveTextContent("Invite teammates on weft.zip");
    await userEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("replays the welcome from the menu and closes it", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const onReplay = vi.fn();
    window.addEventListener("weft:welcome-replay", onReplay);
    localStorage.setItem("weft-tips-seen", '["review"]');
    localStorage.setItem("weft-intros-seen", '["secrets"]');
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Replay the welcome" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("weft-tips-seen")).toBeNull();
    expect(localStorage.getItem("weft-intros-seen")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    window.removeEventListener("weft:welcome-replay", onReplay);
  });

  it("replays the last achievement from the menu, and hides it in quiet mode", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const onReplay = vi.fn();
    window.addEventListener("weft:achievement-replay", onReplay);
    const view = render(<AccountButton onOpenSettings={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Replay last achievement" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    window.removeEventListener("weft:achievement-replay", onReplay);
    view.unmount();

    document.cookie = "weft-show-progress=0; path=/";
    render(<AccountButton onOpenSettings={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    expect(screen.queryByRole("menuitem", { name: "Replay last achievement" })).toBeNull();
    document.cookie = "weft-show-progress=; path=/; max-age=0";
  });

  it("offers Share the board… when the board passes a handler", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const onShareBoard = vi.fn();
    render(<AccountButton onOpenSettings={vi.fn()} onShareBoard={onShareBoard} />);
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Share the board…" }));
    expect(onShareBoard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    // The icon beside the avatar opens it in one click.
    await userEvent.click(screen.getByRole("button", { name: "Share the board" }));
    expect(onShareBoard).toHaveBeenCalledTimes(2);
  });

  it("leaves Share the board… out without a handler", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await screen.findByRole("menuitem", { name: /Settings/ });
    expect(screen.queryByRole("menuitem", { name: "Share the board…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share the board" })).toBeNull();
  });

  it("opens Your team in the pane when in the desktop, falling back to the system browser", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(browserOpen).toHaveBeenCalledWith("https://weft.zip/team", "board");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the system browser when the pane is missing (older shells)", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    (window as unknown as { weft: unknown }).weft = { openExternal };
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(openExternal).toHaveBeenCalledWith("https://weft.zip/team");
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("doesn't open the team page in the pane when the desktop isn't running at all", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    delete (window as unknown as { weft?: unknown }).weft;
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    // Outside the desktop, the helper's pane branch is unavailable; window.open takes over.
    // We just assert the pane path is not taken — jsdom's window.open is a no-op stub here.
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("closes the account menu on Escape and on an outside click", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    const avatar = await screen.findByRole("button", { name: "Signed in as Ada" });
    await userEvent.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("heads the menu with your team, its plan and Upgrade to Pro, which opens the upgrade dialog", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    api.billingStatus.mockResolvedValue({ ...billing, plan: { id: "free", name: "Free" } });
    setup();
    await vi.waitFor(() => expect(api.billingStatus).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    expect(screen.getByRole("menu")).toHaveTextContent("Acme LabsFreeYour current team");
    await userEvent.click(screen.getByRole("menuitem", { name: /Upgrade to Pro/ }));
    expect(openExternal).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(renderHook(() => useUpgradeReason()).result.current).toBe("plan");
    act(() => closeUpgrade());
  });

  it("offers Manage billing on Pro, says when it cancels, and opens a tab outside the desktop", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    api.billingStatus.mockResolvedValue({ ...billing, cancelAtPeriodEnd: true, periodEnd: "2026-11-20T12:00:00Z" });
    delete (window as unknown as { weft?: unknown }).weft;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    expect(await screen.findByText(/Cancels on/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: /Manage billing/ }));
    expect(open).toHaveBeenCalledWith("https://weft.zip/acme/billing", "_blank", "noopener");
    open.mockRestore();
  });

  it("shows a quiet line while the plan loads, and no header when it can't be read", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    api.billingStatus.mockReturnValue(new Promise(() => {}));
    const view = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    expect(screen.getByRole("menu")).toHaveTextContent("Checking your plan");
    view.unmount();

    resetBillingStatus();
    api.billingStatus.mockRejectedValue(new Error("offline"));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await vi.waitFor(() => expect(screen.getByRole("menu")).not.toHaveTextContent("Checking your plan"));
    expect(screen.queryByRole("menuitem", { name: /Upgrade|Manage billing/ })).toBeNull();
  });

  it("falls back to your email, then an initial", async () => {
    api.account.mockResolvedValue({ configured: true, user: { ...ada, name: null, avatar: null } });
    setup();
    const button = await screen.findByRole("button", { name: "Signed in as ada@b.co" });
    expect(button).toHaveTextContent("A");
  });

  it("names no one when the account has neither", async () => {
    api.account.mockResolvedValue({ configured: true, user: { ...ada, name: null, email: null, avatar: null } });
    setup();
    expect(await screen.findByRole("button", { name: "Signed in as your account" })).toHaveTextContent("?");
  });
});
