// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGithubOrgs, useGithubOrgs, useOrgRepos } from "./use-github-orgs";

const callMock = vi.hoisted(() => vi.fn());
vi.mock("./client-api", () => ({ call: callMock }));

const ORGS = [{ login: "acme", avatarUrl: "http://a" }];

beforeEach(() => clearGithubOrgs());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useGithubOrgs", () => {
  it("asks nothing while inactive", () => {
    const { result } = renderHook(() => useGithubOrgs(false));
    expect(result.current).toEqual([]);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("loads the orgs once and opens on them next time", async () => {
    callMock.mockResolvedValue({ orgs: ORGS, error: null });
    const first = renderHook(() => useGithubOrgs(true));
    await waitFor(() => expect(first.result.current).toEqual(ORGS));
    expect(callMock).toHaveBeenCalledWith("GET", "/api/github/orgs");
    first.unmount();
    const { result } = renderHook(() => useGithubOrgs(true));
    expect(result.current).toEqual(ORGS);
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("answers a failure as no orgs", async () => {
    callMock.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useGithubOrgs(true));
    await waitFor(() => expect(callMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("ignores an answer that lands after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    callMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const a = renderHook(() => useGithubOrgs(true));
    a.unmount();
    resolve({ orgs: ORGS, error: null });
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    clearGithubOrgs();
    callMock.mockReturnValueOnce(new Promise((_r, j) => (reject = j)));
    const b = renderHook(() => useGithubOrgs(true));
    b.unmount();
    reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(b.result.current).toEqual([]);
  });
});

describe("useOrgRepos", () => {
  it("is empty for no org", () => {
    const { result } = renderHook(() => useOrgRepos(null));
    expect(result.current).toEqual([]);
    expect(callMock).not.toHaveBeenCalled();
  });

  it("loads an org's repos, keeps them per org, and empties when the org goes", async () => {
    callMock.mockResolvedValue({ repos: ["acme/a"] });
    const { result, rerender, unmount } = renderHook<string[], { org: string | null }>(({ org }) => useOrgRepos(org), { initialProps: { org: "acme co" } });
    await waitFor(() => expect(result.current).toEqual(["acme/a"]));
    expect(callMock).toHaveBeenCalledWith("GET", "/api/github/orgs?org=acme%20co");
    rerender({ org: null });
    await waitFor(() => expect(result.current).toEqual([]));
    rerender({ org: "acme co" });
    await waitFor(() => expect(result.current).toEqual(["acme/a"]));
    expect(callMock).toHaveBeenCalledTimes(1);
    unmount();
    const again = renderHook(() => useOrgRepos("acme co"));
    expect(again.result.current).toEqual(["acme/a"]);
  });

  it("answers a failure as no repos", async () => {
    callMock.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useOrgRepos("acme"));
    await waitFor(() => expect(callMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("ignores an answer that lands after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    callMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderHook(() => useOrgRepos("one")).unmount();
    resolve({ repos: ["one/a"] });
    callMock.mockReturnValueOnce(new Promise((_r, j) => (reject = j)));
    const b = renderHook(() => useOrgRepos("two"));
    b.unmount();
    reject(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(b.result.current).toEqual([]);
  });
});
