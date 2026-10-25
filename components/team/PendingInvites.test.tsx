// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingInvites, type PendingInviteRow } from "./PendingInvites";
import type { TeamActionResult, TeamClientActions, TeamRole } from "@/lib/team-types";
import "../test-utils";

const roleLabels: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

const ada: PendingInviteRow = {
  id: "i1",
  email: "ada@b.co",
  role: "admin",
  roleLabel: "Admin",
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-10-15T00:00:00.000Z",
};
const grace: PendingInviteRow = {
  id: "i2",
  email: "grace@b.co",
  role: "member",
  roleLabel: "Member",
  createdAt: "2026-10-05T00:00:00.000Z",
  expiresAt: "2026-10-19T00:00:00.000Z",
};

function makeActions(): TeamClientActions & {
  revoke: ReturnType<typeof vi.fn<(inviteId: string) => Promise<TeamActionResult>>>;
} {
  return {
    invite: vi.fn<(email: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    changeRole: vi.fn<(userId: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    remove: vi.fn<(userId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    revoke: vi.fn<(inviteId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true, message: "Revoked." }),
    addProject: vi.fn<(repo: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    removeProject: vi.fn<(repo: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    setProjectAccess: vi.fn<(repo: string, userId: string, grant: boolean) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    createTeam: vi.fn<(name: string) => Promise<TeamActionResult & { slug?: string }>>().mockResolvedValue({ ok: true }),
    renameTeam: vi.fn().mockResolvedValue({ ok: true }),
    deleteTeam: vi.fn().mockResolvedValue({ ok: true }),
  };
}

let actions: ReturnType<typeof makeActions>;

beforeEach(() => {
  actions = makeActions();
});

describe("PendingInvites", () => {
  it("renders nothing when there are no invites", () => {
    const { container } = render(<PendingInvites invites={[]} roleLabels={roleLabels} actions={actions} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every invite with email, role and expiry", () => {
    render(<PendingInvites invites={[ada, grace]} roleLabels={roleLabels} actions={actions} />);
    expect(screen.getByText("ada@b.co")).toBeInTheDocument();
    expect(screen.getByText("grace@b.co")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("revokes an invite and shows a success message", async () => {
    render(<PendingInvites invites={[ada]} roleLabels={roleLabels} actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    await waitFor(() => expect(actions.revoke).toHaveBeenCalled());
    expect(actions.revoke).toHaveBeenCalledWith("i1");
    expect(await screen.findByText("Revoked.")).toBeInTheDocument();
  });

  it("shows the action's error message when revoke fails", async () => {
    actions.revoke.mockResolvedValueOnce({ ok: false, message: "Already accepted." });
    render(<PendingInvites invites={[ada]} roleLabels={roleLabels} actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    expect(await screen.findByText("Already accepted.")).toBeInTheDocument();
  });

  it("disables the revoke button while the action is in flight", async () => {
    let resolve!: (value: { ok: boolean; message?: string }) => void;
    actions.revoke.mockImplementationOnce(() => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)));
    render(<PendingInvites invites={[ada]} roleLabels={roleLabels} actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke invite for ada@b.co" }));
    expect(screen.getByRole("button", { name: /Working|Revoke/ })).toBeDisabled();
    resolve({ ok: true, message: "Revoked." });
  });
});
