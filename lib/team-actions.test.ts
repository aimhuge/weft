// The /[orgSlug]/team page's server actions, which are now thin wrappers:
// each runs requireTeam (the gate), then delegates to lib/team-ops.ts's
// runTeamOp, then revalidates the team page on success. The deep business
// behavior — permissions, last-owner rule, self rules, every error message
// — lives in lib/team-ops.test.ts; these tests pin the boundary checks
// (public-endpoint argument validation, revalidation wiring).
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsModMock = vi.hoisted(() => ({
  requireTeam: vi.fn(),
}));

const teamOpsMock = vi.hoisted(() => ({
  runTeamOp: vi.fn(),
  teamSnapshot: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

const createMock = vi.hoisted(() => ({ runCreateTeam: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ webUser: vi.fn() }));

vi.mock("./teams", () => teamsModMock);
vi.mock("./team-create", () => createMock);
vi.mock("./web-session", () => sessionMock);
vi.mock("./team-ops", () => teamOpsMock);
vi.mock("next/cache", () => cacheMock);

import { addProject, boardShareTeam, changeMemberRole, createTeam, removeProject, inviteMember, removeMember, renameTeam, revokeInvite, deleteTeam, setProjectAccess } from "./team-actions";
import { ORG, USER } from "./team-actions.harness";

const CTX = { user: USER, org: ORG, role: "owner" as const, orgs: [ORG], service: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamOpsMock.runTeamOp.mockResolvedValue({ ok: true, message: "ok" });
  cacheMock.revalidatePath.mockReturnValue(undefined);
});

describe("inviteMember", () => {
  it("runs the gate, calls runTeamOp with an invite op, and revalidates on success", async () => {
    const result = await inviteMember("acme", "x@y.com", "member");
    expect(teamsModMock.requireTeam).toHaveBeenCalledWith("acme", "/acme/team");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "invite", email: "x@y.com", role: "member" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
    expect(result).toEqual({ ok: true, message: "ok" });
  });

  it("rejects a non-string role at the boundary", async () => {
    const result = await inviteMember("acme", "x@y.com", "superuser");
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
    expect(teamOpsMock.runTeamOp).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the email", async () => {
    await inviteMember("acme", "  x@y.com  ", "member");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ email: "x@y.com" }));
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "boom" });
    await inviteMember("acme", "x@y.com", "member");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("coerces a non-string email to an empty string before delegating", async () => {
    // The server action's argument is typed as string, but a hostile caller could send anything;
    // the boundary check normalizes it so runTeamOp's isPlausibleEmail gets an empty string.
    await inviteMember("acme", 5 as unknown as string, "member");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ email: "" }));
  });
});

describe("changeMemberRole", () => {
  it("runs the gate, calls runTeamOp with a role op, and revalidates on success", async () => {
    await changeMemberRole("acme", "u2", "admin");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "role", userId: "u2", role: "admin" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("rejects a non-string role at the boundary", async () => {
    const result = await changeMemberRole("acme", "u2", "superuser");
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
    expect(teamOpsMock.runTeamOp).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the user id", async () => {
    await changeMemberRole("acme", "  u2  ", "admin");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ userId: "u2" }));
  });
});

describe("removeMember", () => {
  it("runs the gate, calls runTeamOp with a remove op, and revalidates on success", async () => {
    await removeMember("acme", "u2");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "remove", userId: "u2" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "nope" });
    await removeMember("acme", "u2");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the user id", async () => {
    await removeMember("acme", "  u2  ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ userId: "u2" }));
  });
});

describe("revokeInvite", () => {
  it("runs the gate, calls runTeamOp with a revoke op, and revalidates on success", async () => {
    await revokeInvite("acme", "i1");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "revoke", inviteId: "i1" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "nope" });
    await revokeInvite("acme", "i1");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the invite id", async () => {
    await revokeInvite("acme", "  i1  ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ inviteId: "i1" }));
  });
});

describe("boardShareTeam", () => {
  it("gates on the board's workspace and returns its team snapshot", async () => {
    teamsModMock.requireTeam.mockResolvedValueOnce(CTX);
    teamOpsMock.teamSnapshot.mockResolvedValueOnce({ org: ORG });
    await expect(boardShareTeam("acme")).resolves.toEqual({ org: ORG });
    expect(teamsModMock.requireTeam).toHaveBeenCalledWith("acme", "/acme/team");
    expect(teamOpsMock.teamSnapshot).toHaveBeenCalledWith(CTX);
  });
});

describe("addProject / removeProject", () => {
  it("runs link-project through the gate and revalidates on success", async () => {
    await addProject("acme", "  a/b ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "link-project", repo: "a/b" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("runs unlink-project and skips revalidation on failure", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "no" });
    expect(await removeProject("acme", "a/b")).toEqual({ ok: false, message: "no" });
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "unlink-project", repo: "a/b" });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates after an unlink that worked", async () => {
    await removeProject("acme", "a/b");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("skips revalidation when a link fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false });
    await addProject("acme", "a/b");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setProjectAccess", () => {
  it("runs project-access through the gate and revalidates on success", async () => {
    await setProjectAccess("acme", " a/b ", " u2 ", true);
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "project-access", repo: "a/b", userId: "u2", grant: true });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("reads anything but true as a revoke, and skips revalidation on failure", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "no" });
    expect(await setProjectAccess("acme", "a/b", "u2", "yes")).toEqual({ ok: false, message: "no" });
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "project-access", repo: "a/b", userId: "u2", grant: false });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("renameTeam", () => {
  it("renames through the gate and revalidates the workspace's whole shell", async () => {
    await renameTeam("acme", "  Acme Labs ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "rename", name: "Acme Labs" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("skips revalidation when the rename fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "Only an owner can rename the team." });
    expect(await renameTeam("acme", "X")).toEqual({ ok: false, message: "Only an owner can rename the team." });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteTeam", () => {
  it("deletes through the gate with the typed name and revalidates the shell", async () => {
    await deleteTeam("acme", " Acme ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "delete", confirm: "Acme" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme", "layout");
  });

  it("skips revalidation when the delete is refused", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "no" });
    expect(await deleteTeam("acme", "Acme")).toEqual({ ok: false, message: "no" });
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createTeam", () => {
  it("makes the team for the signed-in visitor", async () => {
    sessionMock.webUser.mockResolvedValueOnce(USER);
    createMock.runCreateTeam.mockResolvedValueOnce({ ok: true, slug: "new" });
    expect(await createTeam("  New ")).toEqual({ ok: true, slug: "new" });
    expect(createMock.runCreateTeam).toHaveBeenCalledWith(USER, "New");
  });

  it("refuses when signed out", async () => {
    sessionMock.webUser.mockResolvedValueOnce(null);
    expect(await createTeam("New")).toEqual({ ok: false, message: "Sign in first." });
    expect(createMock.runCreateTeam).not.toHaveBeenCalled();
  });
});
