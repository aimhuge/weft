// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveButton } from "./LeaveButton";
import type { TeamActionResult, TeamClientActions, TeamRole } from "@/lib/team-types";
import "../test-utils";

function makeActions(): TeamClientActions & {
  remove: ReturnType<typeof vi.fn<(userId: string) => Promise<TeamActionResult>>>;
} {
  return {
    invite: vi.fn<(email: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    changeRole: vi.fn<(userId: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    remove: vi.fn<(userId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true, message: "Left." }),
    revoke: vi.fn<(inviteId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
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

describe("LeaveButton", () => {
  it("asks for confirmation before calling the action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LeaveButton userId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(confirm).toHaveBeenCalled();
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it("calls the action when the visitor confirms and shows the success message", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LeaveButton userId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalled());
    expect(actions.remove).toHaveBeenCalledWith("u1");
    expect(await screen.findByText("Left.")).toBeInTheDocument();
  });

  it("shows the action's error message when leave fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    actions.remove.mockResolvedValueOnce({ ok: false, message: "Owner can't leave." });
    render(<LeaveButton userId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(await screen.findByText("Owner can't leave.")).toBeInTheDocument();
  });

  it("disables the button while the action is in flight", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolve!: (value: { ok: boolean; message?: string }) => void;
    actions.remove.mockImplementationOnce(() => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)));
    render(<LeaveButton userId="u1" actions={actions} />);
    await userEvent.click(screen.getByRole("button", { name: /Leave|Leaving/ }));
    expect(screen.getByRole("button", { name: /Leaving|Leave/ })).toBeDisabled();
    resolve({ ok: true });
  });
});