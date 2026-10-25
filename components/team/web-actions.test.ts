import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  addProject: vi.fn().mockResolvedValue({ ok: true, message: "add" }),
  changeMemberRole: vi.fn().mockResolvedValue({ ok: true, message: "role" }),
  createTeam: vi.fn().mockResolvedValue({ ok: true, slug: "new" }),
  inviteMember: vi.fn().mockResolvedValue({ ok: true, message: "invite" }),
  removeMember: vi.fn().mockResolvedValue({ ok: true, message: "remove" }),
  removeProject: vi.fn().mockResolvedValue({ ok: true, message: "rmproj" }),
  revokeInvite: vi.fn().mockResolvedValue({ ok: true, message: "revoke" }),
  setProjectAccess: vi.fn().mockResolvedValue({ ok: true, message: "access" }),
  renameTeam: vi.fn().mockResolvedValue({ ok: true, message: "renamed" }),
  deleteTeam: vi.fn().mockResolvedValue({ ok: true, message: "deleted" }),
}));
vi.mock("@/lib/team-actions", () => actions);

import { webTeamActions } from "./web-actions";

describe("webTeamActions", () => {
  it("closes over the org slug for every member and project action", async () => {
    const a = webTeamActions("acme");
    await a.invite("x@y.com", "member");
    await a.changeRole("u1", "admin");
    await a.remove("u1");
    await a.revoke("i1");
    await a.addProject("a/b");
    await a.removeProject("a/b");
    await a.setProjectAccess("a/b", "u2", true);
    expect(actions.setProjectAccess).toHaveBeenCalledWith("acme", "a/b", "u2", true);
    expect(actions.inviteMember).toHaveBeenCalledWith("acme", "x@y.com", "member");
    expect(actions.changeMemberRole).toHaveBeenCalledWith("acme", "u1", "admin");
    expect(actions.removeMember).toHaveBeenCalledWith("acme", "u1");
    expect(actions.revokeInvite).toHaveBeenCalledWith("acme", "i1");
    expect(actions.addProject).toHaveBeenCalledWith("acme", "a/b");
    expect(actions.removeProject).toHaveBeenCalledWith("acme", "a/b");
  });

  it("createTeam returns the new slug and takes no org", async () => {
    expect(await webTeamActions("acme").createTeam("New")).toEqual({ ok: true, slug: "new" });
    expect(actions.createTeam).toHaveBeenCalledWith("New");
  });

  it("renameTeam renames the slug it's given, not the one it closes over", async () => {
    expect(await webTeamActions("acme").renameTeam("other", "Other Co")).toEqual({ ok: true, message: "renamed" });
    expect(actions.renameTeam).toHaveBeenCalledWith("other", "Other Co");
  });

  it("deleteTeam deletes the slug it's given, with the typed name", async () => {
    expect(await webTeamActions("acme").deleteTeam("other", "Other")).toEqual({ ok: true, message: "deleted" });
    expect(actions.deleteTeam).toHaveBeenCalledWith("other", "Other");
  });
});
