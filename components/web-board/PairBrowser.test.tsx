// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-utils";

const pairThisBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/web-sync-key", () => ({ pairThisBrowser }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => ({}) }));
const { default: PairBrowser, PENDING_LINK_KEY } = await import("./PairBrowser");

const LINK = `https://weft.zip/pair#v=1&p=11111111-2222-4333-8444-555555555555&s=${"A".repeat(43)}&o=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&m=ab`;
const USER = { id: "u1", name: "Alex" };

beforeEach(() => {
  window.history.replaceState(null, "", "/pair");
  sessionStorage.clear();
  pairThisBrowser.mockReset();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("PairBrowser", () => {
  it("asks a signed-out visitor to sign in, keeping the link", () => {
    window.history.replaceState(null, "", `/pair${LINK.slice(LINK.indexOf("#"))}`);
    render(<PairBrowser user={null} />);
    const link = screen.getByRole("link", { name: /Continue with GitHub/ });
    expect(link.getAttribute("href")).toContain("next=%2Fpair");
    expect(sessionStorage.getItem(PENDING_LINK_KEY)).toContain("#v=1");
  });

  it("says when the link is missing", () => {
    render(<PairBrowser user={USER} />);
    expect(screen.getByText(/needs the whole pairing link/)).toBeInTheDocument();
  });

  it("pairs with the link kept from before sign-in", async () => {
    sessionStorage.setItem(PENDING_LINK_KEY, LINK);
    pairThisBrowser.mockResolvedValue("paired");
    render(<PairBrowser user={USER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair this browser" }));
    expect(await screen.findByText(/Paired\. Your web board/)).toBeInTheDocument();
    expect(pairThisBrowser).toHaveBeenCalledWith(expect.anything(), LINK, expect.objectContaining({ id: "u1" }));
    expect(sessionStorage.getItem(PENDING_LINK_KEY)).toBeNull();
  });

  it("shows a refusal and an error", async () => {
    window.history.replaceState(null, "", `/pair${LINK.slice(LINK.indexOf("#"))}`);
    pairThisBrowser.mockResolvedValueOnce("refused").mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(<PairBrowser user={USER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair this browser" }));
    expect(await screen.findByText(/didn't pair this browser/)).toBeInTheDocument();
    unmount();
    render(<PairBrowser user={USER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair this browser" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
