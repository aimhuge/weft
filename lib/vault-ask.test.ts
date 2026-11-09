// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { askVault, parseVaultAsk, secretsLink, useShareAsked, useVaultAsk } from "./vault-ask";
import type { VaultSummary } from "./vault-view";

const vault = (repo: string, folder: string) => ({ id: `github:${repo}`, folder }) as unknown as VaultSummary;

describe("parseVaultAsk", () => {
  it("takes a repo and the share flag, lower-cased", () => {
    expect(parseVaultAsk(JSON.stringify({ repo: "AimHuge/Weft", share: true }))).toEqual({ repo: "aimhuge/weft", share: true });
    expect(parseVaultAsk(JSON.stringify({ repo: "a/b", share: "1" }))).toEqual({ repo: "a/b", share: false });
  });

  it("refuses anything else", () => {
    expect(parseVaultAsk(undefined)).toBeNull();
    expect(parseVaultAsk("{nope")).toBeNull();
    expect(parseVaultAsk(JSON.stringify({ repo: "../etc" }))).toBeNull();
    expect(parseVaultAsk(JSON.stringify({ repo: 7 }))).toBeNull();
  });
});

describe("secretsLink", () => {
  it("builds the weft:// link", () => {
    expect(secretsLink("AimHuge/weft", true)).toBe("weft://secrets?repo=aimhuge%2Fweft&share=1");
    expect(secretsLink("a/b", false)).toBe("weft://secrets?repo=a%2Fb");
  });
});

describe("askVault + useVaultAsk + useShareAsked", () => {
  it("does nothing for no ask", () => {
    const open = vi.fn();
    askVault(open, null);
    expect(open).not.toHaveBeenCalled();
  });

  it("waits for the drawer's vaults, then picks the folder and asks that section to share, once", () => {
    const open = vi.fn();
    const pick = vi.fn();
    askVault(open, { repo: "a/b", share: true });
    expect(open).toHaveBeenCalledWith("vault");

    const drawer = renderHook(({ vaults }) => useVaultAsk(vaults, pick), { initialProps: { vaults: undefined as VaultSummary[] | undefined } });
    expect(pick).not.toHaveBeenCalled();
    const section = renderHook(() => useShareAsked("a/b"));
    const other = renderHook(() => useShareAsked("c/d"));

    act(() => drawer.rerender({ vaults: [vault("c/d", "/c"), vault("a/b", "/a")] }));
    expect(pick).toHaveBeenCalledWith("/a");
    // Taken and cleared by its own effect, so it reads false again after.
    expect(section.result.current).toBe(false);
    expect(other.result.current).toBe(false);
    drawer.unmount();
    section.unmount();
    other.unmount();
  });

  it("serves a live drawer at once, and a plain ask only filters", () => {
    const pick = vi.fn();
    const drawer = renderHook(() => useVaultAsk([vault("a/b", "/a")], pick));
    const seen: boolean[] = [];
    renderHook(() => seen.push(useShareAsked("a/b")));
    act(() => askVault(vi.fn(), { repo: "a/b", share: false }));
    expect(pick).toHaveBeenCalledWith("/a");
    expect(seen).not.toContain(true);
    act(() => askVault(vi.fn(), { repo: "a/b", share: true }));
    expect(seen).toContain(true);
    drawer.unmount();
  });

  it("keeps an ask for a repo the drawer doesn't have", () => {
    const pick = vi.fn();
    const drawer = renderHook(() => useVaultAsk([vault("a/b", "/a")], pick));
    askVault(vi.fn(), { repo: "x/y", share: false });
    expect(pick).not.toHaveBeenCalled();
    drawer.unmount();
    renderHook(() => useVaultAsk([vault("x/y", "/x")], pick));
    expect(pick).toHaveBeenCalledWith("/x");
  });

  it("keeps the newest drawer's taker when an older one goes", () => {
    const older = vi.fn();
    const newer = vi.fn();
    const first = renderHook(() => useVaultAsk([vault("a/b", "/old")], older));
    const second = renderHook(() => useVaultAsk([vault("a/b", "/new")], newer));
    first.unmount();
    askVault(vi.fn(), { repo: "a/b", share: false });
    expect(newer).toHaveBeenCalledWith("/new");
    expect(older).not.toHaveBeenCalled();
    second.unmount();
  });

  it("renders false on the server", async () => {
    const { renderToString } = await import("react-dom/server");
    const { createElement } = await import("react");
    const Probe = () => createElement("i", null, String(useShareAsked("a/b")));
    expect(renderToString(createElement(Probe))).toContain("false");
  });

  it("is never asked for an empty repo", () => {
    const { result } = renderHook(() => useShareAsked(""));
    expect(result.current).toBe(false);
  });
});
