// @vitest-environment happy-dom
// Add project's 🔐 half: after a link, useTeam shares this Mac's vault for the repo with the team (lib/team-vault-link.ts).
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchMock, jsonResponse, stubTeamFetch, team } from "./use-team.harness";

const vaultLink = vi.hoisted(() => ({
  shareLinkedRepo: vi.fn(() => Promise.resolve<unknown>({ secrets: 2 })),
  linkNote: vi.fn(() => "Linked note."),
}));
vi.mock("./team-vault-link", () => vaultLink);

const { clearTeamCache, useTeam } = await import("./use-team");

stubTeamFetch(clearTeamCache);

async function loaded() {
  const hook = renderHook(() => useTeam("acme"));
  await waitFor(() => expect(hook.result.current.state.kind).toBe("ok"));
  return hook.result;
}

const answerPosts = (body: unknown) =>
  fetchMock.mockImplementation((_url, init) => Promise.resolve(init?.method === "POST" ? jsonResponse(200, body) : jsonResponse(200, team)));

describe("useTeam addProject", () => {
  it("shares the linked repo's vault with the team and says what happened", async () => {
    const result = await loaded();
    answerPosts({ ok: true });
    const out = await act(() => result.current.actions.addProject("aimhuge/weft"));
    expect(vaultLink.shareLinkedRepo).toHaveBeenCalledWith("o1", "Acme", "aimhuge/weft");
    expect(vaultLink.linkNote).toHaveBeenCalledWith("aimhuge/weft", "Acme", { secrets: 2 });
    expect(out).toMatchObject({ ok: true, message: "Linked note." });
  });

  it("doesn't share the vault when the link fails", async () => {
    const result = await loaded();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    expect(await act(() => result.current.actions.addProject("aimhuge/weft"))).toEqual({ ok: false, message: "boom" });
    expect(vaultLink.shareLinkedRepo).not.toHaveBeenCalled();
  });

  it("doesn't share the vault again when the repo was already linked", async () => {
    const result = await loaded();
    answerPosts({ ok: true, message: "Already linked." });
    expect(await act(() => result.current.actions.addProject("aimhuge/weft"))).toMatchObject({ ok: true, message: "Already linked." });
    expect(vaultLink.shareLinkedRepo).not.toHaveBeenCalled();
    expect(vaultLink.linkNote).not.toHaveBeenCalled();
  });
});
