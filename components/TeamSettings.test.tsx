// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamClientActions, TeamSnapshot } from "@/lib/team-types";
import type { TeamHook, TeamHookState } from "@/lib/use-team";
import "./test-utils";
import TeamSettings from "./TeamSettings";

const useTeamMock = vi.hoisted(() => vi.fn<(_org?: string) => TeamHook>());

vi.mock("@/lib/use-team", () => ({ useTeam: useTeamMock, prefetchTeam: vi.fn() }));
vi.mock("@/lib/use-board-repos", () => ({ useBoardRepos: () => ["aimhuge/weft", "aimhuge/other"] }));
vi.mock("./team/ProjectPeople", () => ({ ProjectPeople: () => null }));

const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const acme = { id: "o1", slug: "acme", name: "Acme", role: "owner" as const };
const weft = { id: "o2", slug: "weft", name: "Weft Co", role: "member" as const };

const team: TeamSnapshot = {
  user: ada,
  org: acme,
  role: "owner",
  orgs: [acme, weft],
  canManage: true,
  members: [
    { userId: "u1", email: "ada@b.co", name: "Ada", role: "owner", joinedAt: "2026-09-01T00:00:00.000Z" },
    { userId: "u2", email: "grace@b.co", name: "Grace", role: "admin", joinedAt: "2026-10-01T00:00:00.000Z" },
  ],
  pending: [
    { id: "i1", email: "linus@b.co", role: "member", createdAt: "2026-10-05T00:00:00.000Z", expiresAt: "2026-10-19T00:00:00.000Z" },
  ],
  projects: [{ repo: "aimhuge/weft", addedAt: "2026-10-01T00:00:00.000Z", addedBy: "u1", access: [] }],
  roleOptions: [
    { role: "owner", label: "Owner", description: "Full control." },
    { role: "admin", label: "Admin", description: "Manage the workspace." },
    { role: "member", label: "Member", description: "View and publish." },
  ],
  roleLabels: { owner: "Owner", admin: "Admin", member: "Member" },
};

function actions(): TeamClientActions {
  return {
    invite: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    changeRole: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    remove: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    revoke: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    addProject: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    setProjectAccess: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    createTeam: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    renameTeam: vi.fn().mockResolvedValue({ ok: true }),
    deleteTeam: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// The dialog page header ("Teams / Every Weft team you're in…") lives in
// lib/settings-nav.ts and is rendered by SettingsDialog, not here. TeamSettings
// just feeds useTeam(org) into the cards below it.
function setHook(state: TeamHookState) {
  useTeamMock.mockReturnValue({ state, refresh: vi.fn(), actions: actions() });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("TeamSettings", () => {
  it("shows a loading line while the team is loading", () => {
    setHook({ kind: "loading" });
    render(<TeamSettings />);
    expect(screen.getByText(/Loading your teams/)).toBeInTheDocument();
  });

  it("shows the signed-out hint and a sign-in hint pointing at Accounts", () => {
    setHook({ kind: "signed-out" });
    render(<TeamSettings />);
    expect(screen.getByText(/Sign in to your Weft account/)).toBeInTheDocument();
    expect(screen.getByText(/Settings → Accounts/)).toBeInTheDocument();
  });

  it("shows an error message with a Try again button", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useTeamMock.mockReturnValue({ state: { kind: "error", message: "offline" }, refresh, actions: actions() });
    render(<TeamSettings />);
    expect(screen.getByText(/offline/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("renders the workspace, roster, invite form, pending invites, and Open on weft.zip", () => {
    setHook({ kind: "ok", team });
    render(<TeamSettings />);
    // The picked team heads its own sections, below the list of every team.
    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("grace@b.co")).toBeInTheDocument();
    expect(screen.getByText("linus@b.co")).toBeInTheDocument();
    // The invite form, the pending list, the Open-on-weft.zip link.
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open on weft.zip" })).toBeInTheDocument();
    // The heading counts the people, the invites and the projects.
    expect(screen.getByText("2 members · 1 invited · 1 project")).toBeInTheDocument();
  });

  it("hides the invite form and pending list when the user can't manage", () => {
    const member = { ...team, canManage: false, pending: [] };
    setHook({ kind: "ok", team: member });
    render(<TeamSettings />);
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
    expect(screen.queryByText("linus@b.co")).not.toBeInTheDocument();
  });

  it("shows a Leave button for non-owners and hides it for owners", () => {
    setHook({ kind: "ok", team: { ...team, role: "admin" } });
    const { rerender } = render(<TeamSettings />);
    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeInTheDocument();
    setHook({ kind: "ok", team: { ...team, role: "owner" } });
    rerender(<TeamSettings />);
    expect(screen.queryByRole("button", { name: "Leave workspace" })).not.toBeInTheDocument();
  });

  it("lists your teams and offers New team even when you're in one", () => {
    setHook({ kind: "ok", team: { ...team, orgs: [acme] } });
    render(<TeamSettings />);
    expect(screen.getByText("Your teams · 1")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Your teams" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "New team" })).toBeInTheDocument();
  });

  it("lists every team with your role and remembers the pick", async () => {
    setHook({ kind: "ok", team });
    render(<TeamSettings />);
    expect(screen.getByText("Your teams · 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("Acme");
    await userEvent.click(screen.getByRole("button", { name: "Weft Co" }));
    expect(window.localStorage.getItem("weft-team-org")).toBe("weft");
    expect(useTeamMock).toHaveBeenLastCalledWith("weft");
  });

  it("keeps the list up while the picked team loads, then shows it", async () => {
    let weftState: TeamHookState = { kind: "loading" };
    useTeamMock.mockImplementation((org) => ({
      state: org === "weft" ? weftState : { kind: "ok", team },
      refresh: vi.fn(),
      actions: actions(),
    }));
    const { rerender } = render(<TeamSettings />);
    await userEvent.click(screen.getByRole("button", { name: "Weft Co" }));
    expect(screen.getByText("Loading Weft Co")).toBeInTheDocument();
    expect(screen.getByRole("button", { current: true })).toHaveTextContent("Weft Co");
    expect(screen.queryByRole("heading", { name: "Acme" })).not.toBeInTheDocument();
    weftState = { kind: "ok", team: { ...team, org: weft, role: "member", canManage: false } };
    rerender(<TeamSettings />);
    expect(screen.getByRole("heading", { name: "Weft Co" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeInTheDocument();
  });

  it("keeps the list up when the picked team fails to load, with Try again", async () => {
    const refresh = vi.fn();
    useTeamMock.mockImplementation((org) => ({
      state: org === "weft" ? { kind: "error", message: "offline" } : { kind: "ok", team },
      refresh,
      actions: actions(),
    }));
    render(<TeamSettings />);
    await userEvent.click(screen.getByRole("button", { name: "Weft Co" }));
    expect(screen.getByText(/offline/)).toBeInTheDocument();
    expect(screen.getByText("Your teams · 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("describes the invite roles in Weft's words, not the package's", () => {
    setHook({ kind: "ok", team });
    render(<TeamSettings />);
    expect(screen.getByText(/Sees the team's projects, synced boards and people/)).toBeInTheDocument();
    expect(screen.queryByText("View and publish.")).not.toBeInTheDocument();
  });

  it("opens on the remembered team, and falls back to the default when it's no longer listed", async () => {
    window.localStorage.setItem("weft-team-org", "gone");
    setHook({ kind: "ok", team: { ...team, org: { ...acme, slug: "gone" } } });
    render(<TeamSettings />);
    expect(useTeamMock).toHaveBeenCalledWith("gone");
    await waitFor(() => expect(useTeamMock).toHaveBeenLastCalledWith(undefined));
    expect(window.localStorage.getItem("weft-team-org")).toBeNull();
  });

  it("falls back to the default when the remembered team is not found", async () => {
    window.localStorage.setItem("weft-team-org", "gone");
    setHook({ kind: "error", message: "No workspace found." });
    render(<TeamSettings />);
    await waitFor(() => expect(useTeamMock).toHaveBeenLastCalledWith(undefined));
  });

  it("shows the projects, and Add project only to those who manage", async () => {
    const a = actions();
    useTeamMock.mockReturnValue({ state: { kind: "ok", team }, refresh: vi.fn(), actions: a });
    const { unmount } = render(<TeamSettings />);
    expect(screen.getByRole("link", { name: "aimhuge/weft" })).toHaveAttribute("href", "https://github.com/aimhuge/weft");
    await userEvent.selectOptions(screen.getByLabelText("Project from your board"), "aimhuge/other");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(a.addProject).toHaveBeenCalledWith("aimhuge/other"));
    unmount();
    setHook({ kind: "ok", team: { ...team, canManage: false, role: "member" } });
    render(<TeamSettings />);
    expect(screen.getByRole("link", { name: "aimhuge/weft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add project" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("inviting through the form calls actions.invite, as a Member unless you pick another role", async () => {
    const a = actions();
    useTeamMock.mockReturnValue({ state: { kind: "ok", team }, refresh: vi.fn(), actions: a });
    render(<TeamSettings />);
    await userEvent.type(screen.getByLabelText("Email"), "linus@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(a.invite).toHaveBeenCalledWith("linus@b.co", "member"));
  });
});
