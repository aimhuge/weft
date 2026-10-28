// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Roster, type RoleOption } from "./Roster";
import type { TeamClientActions, TeamMember } from "@/lib/team-types";
import "../test-utils";

// The Roster component takes TeamMember (lib/team-types) and computes the
// "you" pill against currentUserId, so the test passes raw snapshot rows.
const ada: TeamMember = {
  userId: "u1",
  email: "ada@b.co",
  name: "Ada",
  role: "owner",
  joinedAt: "2026-09-01T00:00:00.000Z",
};
const grace: TeamMember = {
  userId: "u2",
  email: "grace@b.co",
  name: "Grace",
  role: "admin",
  joinedAt: "2026-10-01T00:00:00.000Z",
};
const linus: TeamMember = {
  userId: "u3",
  email: null,
  name: null,
  role: "member",
  joinedAt: "2026-10-05T00:00:00.000Z",
};

const options: RoleOption[] = [
  { role: "owner", label: "Owner" },
  { role: "admin", label: "Admin" },
  { role: "member", label: "Member" },
];

function makeActions(): TeamClientActions & {
  changeRole: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  invite: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  return {
    changeRole: vi.fn().mockResolvedValue({ ok: true, message: "Saved." }),
    remove: vi.fn().mockResolvedValue({ ok: true, message: "Removed." }),
    invite: vi.fn().mockResolvedValue({ ok: true, message: "Invite sent." }),
    revoke: vi.fn().mockResolvedValue({ ok: true, message: "Revoked." }),
    addProject: vi.fn().mockResolvedValue({ ok: true, message: "Linked." }),
    removeProject: vi.fn().mockResolvedValue({ ok: true, message: "Unlinked." }),
    setProjectAccess: vi.fn().mockResolvedValue({ ok: true, message: "Granted." }),
    createTeam: vi.fn().mockResolvedValue({ ok: true, message: "Created." }),
    renameTeam: vi.fn().mockResolvedValue({ ok: true }),
    deleteTeam: vi.fn().mockResolvedValue({ ok: true }),
  };
}

let actions: ReturnType<typeof makeActions>;

beforeEach(() => {
  actions = makeActions();
});

describe("Roster", () => {
  it("shows the empty hint when there are no members", () => {
    render(<Roster members={[]} canManage={false} roleOptions={options} currentUserId="u1" actions={actions} />);
    expect(screen.getByText(/No members yet/)).toBeInTheDocument();
  });

  it("renders names, roles, joined dates and the 'you' pill", () => {
    render(<Roster members={[ada, grace, linus]} canManage={false} roleOptions={options} currentUserId="u1" actions={actions} />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("grace@b.co")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
    // The fallback name is an em-dash when both displayName and email are null.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Joined column: each row has a formatted date.
    const dates = screen.getAllByText(/20\d{2}/);
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });

  it("shows role labels, capitalizing a role the options leave out", () => {
    // An admin's options have no Owner; the owner's row still reads "Owner", not "owner".
    render(<Roster members={[ada, grace]} canManage={false} roleOptions={options.slice(1)} currentUserId="u2" actions={actions} />);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
  });

  it("shows the secondary email line when name and email differ", () => {
    render(<Roster members={[ada, grace]} canManage={false} roleOptions={options} currentUserId="u1" actions={actions} />);
    expect(screen.getByText("ada@b.co")).toBeInTheDocument();
  });

  it("hides role select and Remove button for non-managers", () => {
    render(<Roster members={[ada, grace]} canManage={false} roleOptions={options} currentUserId="u1" actions={actions} />);
    expect(screen.queryByRole("combobox", { name: /Role for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("shows role select and Remove button for managers, on rows that aren't you", () => {
    render(<Roster members={[ada, grace]} canManage={true} roleOptions={options} currentUserId="u1" actions={actions} />);
    // Grace gets a select + Remove button; the "you" row (Ada) gets neither.
    const graceSelect = screen.getByRole("combobox", { name: "Role for Grace" });
    expect(graceSelect).toHaveValue("admin");
    const removeButtons = screen.getAllByRole("button", { name: /Remove/ });
    expect(removeButtons).toHaveLength(1);
  });

  it("does not show a Remove button on the manager's own row", () => {
    render(<Roster members={[ada]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    // A manager can't remove themselves — Leave workspace is the path off the roster.
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("changing the role select calls actions.changeRole with (userId, role)", async () => {
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "owner");
    await waitFor(() => expect(actions.changeRole).toHaveBeenCalledTimes(1));
    expect(actions.changeRole).toHaveBeenCalledWith("u2", "owner");
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows the action's error message when the change fails", async () => {
    actions.changeRole.mockResolvedValueOnce({ ok: false, message: "You can’t promote to owner." });
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "owner");
    expect(await screen.findByText("You can’t promote to owner.")).toBeInTheDocument();
  });

  it("Remove button asks for confirmation and calls actions.remove when confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Grace"));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledTimes(1));
    // The rotate box is on by default, so the removal asks for the vault keys to be turned.
    expect(actions.remove).toHaveBeenCalledWith("u2", true);
    expect(await screen.findByText("Removed.")).toBeInTheDocument();
  });

  it("asks to turn the shared vaults' keys when the rotate box is ticked", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    expect(screen.getByRole("checkbox", { name: /Rotate shared vaults/i })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("turn the shared vaults"));
  });

  it("doesn't ask to turn the keys when the rotate box is unticked", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Rotate shared vaults/i }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalledWith(expect.not.stringContaining("turn the shared vaults"));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledTimes(1));
    expect(actions.remove).toHaveBeenCalledWith("u2", false);
  });

  it("Remove button does not call actions.remove when the visitor cancels the confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Roster members={[grace]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    expect(confirm).toHaveBeenCalled();
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it("the change action is called with the row's userId", async () => {
    render(<Roster members={[grace, linus]} canManage roleOptions={options} currentUserId="u1" actions={actions} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role for Grace" }), "member");
    await waitFor(() => expect(actions.changeRole).toHaveBeenCalled());
    expect(actions.changeRole).toHaveBeenCalledWith("u2", "member");
  });
});
