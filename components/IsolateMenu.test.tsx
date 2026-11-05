// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));
const { default: IsolateMenu } = await import("./IsolateMenu");

const BRANCHES = [
  { name: "main", at: 0, worktree: "/repo" },
  { name: "feat/login", at: Math.floor(Date.now() / 1000) - 3600 },
  { name: "fix/old" },
];

beforeEach(() => apiFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ branches: BRANCHES }))));
afterEach(cleanup);

function menu(props: Partial<Parameters<typeof IsolateMenu>[0]> = {}) {
  const onSet = vi.fn();
  const onBranch = vi.fn();
  const view = render(<IsolateMenu cwd="/repo" on={false} suggest={false} branch="" onSet={onSet} onBranch={onBranch} {...props} />);
  return { onSet, onBranch, view };
}

describe("IsolateMenu", () => {
  it("reads Shared, Isolate? with a dot when suggested, and the branch or Worktree when on", () => {
    const { view } = menu();
    expect(screen.getByRole("button", { name: /Isolation/ }).textContent).toContain("Shared");
    view.rerender(<IsolateMenu cwd="/repo" on={false} suggest branch="" onSet={() => {}} onBranch={() => {}} />);
    expect(screen.getByRole("button", { name: /Isolation/ }).textContent).toContain("Isolate?");
    view.rerender(<IsolateMenu cwd="/repo" on suggest branch="" onSet={() => {}} onBranch={() => {}} />);
    expect(screen.getByRole("button", { name: /Isolation/ }).textContent).toContain("Worktree");
    view.rerender(<IsolateMenu cwd="/repo" on suggest={false} branch="feat/login" onSet={() => {}} onBranch={() => {}} />);
    expect(screen.getByRole("button", { name: /Isolation/ }).textContent).toContain("feat/login");
  });

  it("switches between Shared and Worktree, and hides branches while shared", async () => {
    const { onSet } = menu();
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "Worktree" }));
    expect(onSet).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("radio", { name: "Shared" }));
    expect(onSet).toHaveBeenCalledWith(false);
  });

  it("lists branches, greys out one checked out elsewhere, and picks one", async () => {
    const { onBranch } = menu({ on: true });
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    expect(apiFetch).toHaveBeenCalledWith("/api/worktrees?cwd=%2Frepo");
    expect(await screen.findByRole("option", { name: /feat\/login.*1h ago/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /main.*in use/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("option", { name: /Its own weft/ }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("option", { name: /fix\/old/ }));
    expect(onBranch).toHaveBeenCalledWith("fix/old");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("searches, offers to create a new name, and takes it on Enter", async () => {
    const { onBranch } = menu({ on: true });
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    await screen.findByRole("option", { name: /feat\/login/ });
    await userEvent.type(screen.getByRole("textbox", { name: "Branch" }), "feat/new");
    expect(screen.queryByRole("option", { name: /Its own weft/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Create “feat\/new”/ })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(onBranch).toHaveBeenCalledWith("feat/new");
  });

  it("takes an exact match on Enter, and says when nothing matches", async () => {
    const { onBranch } = menu({ on: true });
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    await screen.findByRole("option", { name: /feat\/login/ });
    const box = screen.getByRole("textbox", { name: "Branch" });
    await userEvent.type(box, "feat/login{Enter}");
    expect(onBranch).toHaveBeenLastCalledWith("feat/login");
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Branch" }), "a..b");
    expect(screen.getByText("No branch matches.")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(onBranch).toHaveBeenCalledTimes(1);
    await userEvent.clear(screen.getByRole("textbox", { name: "Branch" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Branch" }), "fix{Enter}");
    expect(onBranch).toHaveBeenLastCalledWith("fix");
  });

  it("closes on Escape and on a click outside", async () => {
    menu({ on: true });
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Isolation/ }));
    await userEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
