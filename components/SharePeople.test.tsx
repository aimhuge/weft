// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareGrant } from "@/lib/share-grant-types";

// The Share dialog's People field, with the grants API faked: suggestions, search, adding, chips and removing.

const grantApi = vi.hoisted(() => ({ list: vi.fn(), grant: vi.fn(), revoke: vi.fn(), people: vi.fn() }));
vi.mock("@/lib/share-grant-client", () => ({ grantApi }));

const { SharePeople, CopyLinkInline } = await import("./SharePeople");

const grant = (login: string, extra: Partial<ShareGrant> = {}): ShareGrant => ({
  githubId: login.length,
  login,
  via: "share",
  createdAt: "2026-11-09T00:00:00Z",
  notifiedAt: null,
  openedAt: null,
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  // jsdom has no layout, so the list's scroll-to-highlight is a no-op here.
  Element.prototype.scrollIntoView = vi.fn();
  Object.values(grantApi).forEach((fn) => fn.mockReset());
  grantApi.list.mockResolvedValue({ shareId: "s1", grants: [] });
  grantApi.people.mockResolvedValue([]);
});

function field() {
  return screen.getByPlaceholderText("@github username");
}

describe("SharePeople", () => {
  it("lists who's in, each with what happened", async () => {
    grantApi.list.mockResolvedValue({
      shareId: "s1",
      grants: [grant("ada", { notifiedAt: "2026-11-09T00:00:00Z" }), grant("bob"), grant("cy", { openedAt: new Date().toISOString() })],
    });
    render(<SharePeople cardId="c1" url="https://weft.zip/s/s1" />);
    expect(await screen.findByText("@ada")).toBeTruthy();
    expect(screen.getByText("emailed")).toBeTruthy();
    expect(screen.getByText(/no email on file/)).toBeTruthy();
    expect(screen.getByText("Copy link")).toBeTruthy();
    expect(screen.getByText("opened just now")).toBeTruthy();
  });

  it("opens on the repo's people and grants one picked, saying when there's no email", async () => {
    grantApi.people.mockResolvedValue([{ login: "octo", name: null, avatarUrl: "https://a/x", kind: "repo" }]);
    grantApi.grant.mockResolvedValue([{ login: "octo", ok: true, grant: grant("octo"), notice: "no-email" }]);
    render(<SharePeople cardId="c1" url="https://weft.zip/s/s1" />);
    fireEvent.focus(field());
    expect(grantApi.people).toHaveBeenCalledWith("", "c1");
    fireEvent.click(await screen.findByRole("option", { name: /@octo/ }));
    await waitFor(() => expect(grantApi.grant).toHaveBeenCalledWith("c1", { logins: ["octo"], via: "share" }));
    expect(await screen.findByText(/no email on file/)).toBeTruthy();
  });

  it("searches GitHub as you type and grants the highlighted one on Enter", async () => {
    vi.useFakeTimers();
    grantApi.people.mockImplementation((q: string) => Promise.resolve(q ? [{ login: "torvalds", name: "Linus", avatarUrl: null, kind: "github" }] : []));
    grantApi.grant.mockResolvedValue([{ login: "torvalds", ok: true, grant: grant("torvalds"), notice: "emailed" }]);
    render(<SharePeople cardId="c1" url={null} />);
    fireEvent.change(field(), { target: { value: "torv" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();
    expect(grantApi.people).toHaveBeenCalledWith("torv");
    expect(await screen.findByRole("option", { name: /@torvalds/ })).toBeTruthy();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await screen.findByText("emailed")).toBeTruthy();
  });

  it("grants a typed login with no match, and shows a refusal on its own line", async () => {
    grantApi.grant.mockResolvedValue([{ login: "nobody", ok: false, error: "No GitHub user @nobody." }]);
    render(<SharePeople cardId="c1" url={null} />);
    fireEvent.change(field(), { target: { value: "@nobody" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "No GitHub user @nobody.");
  });

  it("says a thrown error, and ignores an impossible login", async () => {
    grantApi.grant.mockRejectedValue(new Error("offline"));
    render(<SharePeople cardId="c1" url={null} />);
    fireEvent.change(field(), { target: { value: "-bad" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(grantApi.grant).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "good" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "offline");
  });

  it("removes a person, and closes the list on Escape and blur", async () => {
    grantApi.list.mockResolvedValue({ shareId: "s1", grants: [grant("ada")] });
    grantApi.revoke.mockResolvedValue({ shareId: "s1", grants: [] });
    grantApi.people.mockResolvedValue([{ login: "zed", name: null, avatarUrl: null, kind: "repo" }]);
    render(<SharePeople cardId="c1" url={null} />);
    fireEvent.click(await screen.findByLabelText("Remove @ada"));
    await waitFor(() => expect(screen.queryByText("@ada")).toBeNull());
    expect(grantApi.revoke).toHaveBeenCalledWith("c1", 3);
    fireEvent.focus(field());
    expect(await screen.findByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(field());
    fireEvent.blur(field());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says a removal that failed", async () => {
    grantApi.list.mockResolvedValue({ shareId: "s1", grants: [grant("ada")] });
    grantApi.revoke.mockRejectedValue(new Error("nope"));
    render(<SharePeople cardId="c1" url={null} />);
    fireEvent.click(await screen.findByLabelText("Remove @ada"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "nope");
  });
});

describe("CopyLinkInline", () => {
  it("copies the link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyLinkInline url="https://weft.zip/s/s1" />);
    fireEvent.click(screen.getByText("Copy link"));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://weft.zip/s/s1");
  });
});
