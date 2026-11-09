// @vitest-environment happy-dom
// useTeam's actions on whole workspaces: create, rename and delete. Each changes every cached snapshot's
// `orgs` list, so they forget the cache, unlike the member and project actions in use-team.test.ts.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fetchMock, jsonResponse, stubTeamFetch, team } from "./use-team.harness";

const { clearTeamCache, useTeam } = await import("./use-team");

stubTeamFetch(clearTeamCache);

describe("useTeam workspace actions", () => {
  it("createTeam posts the name, returns the slug and forgets the cached teams", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(200, { ok: true, slug: "new-co" }) : jsonResponse(200, team)),
    );
    const out = await act(() => result.current.actions.createTeam("New Co"));
    expect(out).toEqual({ ok: true, message: undefined, slug: "new-co" });
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
    expect(post?.[1]?.body).toBe(JSON.stringify({ action: "create", name: "New Co" }));
    const before = fetchMock.mock.calls.length;
    renderHook(() => useTeam("acme-2"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("createTeam posts a slug only when given one", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(200, { ok: true, slug: "acme-hq" }) : jsonResponse(200, team)),
    );
    await act(() => result.current.actions.createTeam("Acme", "acme-hq"));
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
    expect(post?.[1]?.body).toBe(JSON.stringify({ action: "create", name: "Acme", slug: "acme-hq" }));
  });

  it("renameTeam posts the slug it's given and forgets the cached teams", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(200, { ok: true, message: "Renamed to Other Labs." }) : jsonResponse(200, team)),
    );
    const out = await act(() => result.current.actions.renameTeam("other", "Other Labs"));
    expect(out.ok).toBe(true);
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
    expect(post?.[1]?.body).toBe(JSON.stringify({ org: "other", action: "rename", name: "Other Labs" }));
    const before = fetchMock.mock.calls.length;
    renderHook(() => useTeam("acme-2"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("deleteTeam posts the slug and the typed name", async () => {
    const { result } = renderHook(() => useTeam("acme"));
    await waitFor(() => expect(result.current.state.kind).toBe("ok"));
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(200, { ok: true, message: "Deleted Old." }) : jsonResponse(200, team)),
    );
    expect((await act(() => result.current.actions.deleteTeam("old", "Old"))).ok).toBe(true);
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
    expect(post?.[1]?.body).toBe(JSON.stringify({ org: "old", action: "delete", confirm: "Old" }));
  });

  it("createTeam works with no team loaded and keeps the cache on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "signed-out" }));
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.state.kind).toBe("signed-out"));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: false, message: "Name taken." }));
    expect(await act(() => result.current.actions.createTeam("X"))).toEqual({ ok: false, message: "Name taken." });
  });
});
