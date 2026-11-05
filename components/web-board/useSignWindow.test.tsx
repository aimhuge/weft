// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test-utils";
import { useSignWindow } from "./useSignWindow";

const devices = (rows: unknown[]) => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }) }) }) as never;
const row = (pending: unknown) => ({ card_id: "c1", card: { pending } }) as never;
const ask = { id: "p1", toolName: "Bash", title: "Run", input: { command: "ls" } };

afterEach(() => vi.restoreAllMocks());

describe("useSignWindow", () => {
  it("opens sign.weft.zip in its own tab with only the ids, once a passkey browser is paired", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useSignWindow(devices([{ passkey_id: "k", revoked_at: null }])));
    await waitFor(() => expect(result.current.needs(row(ask), true)).toBe(true));
    // A Deny, a grant, a phone-only ask or a question answers on the board, as before.
    expect(result.current.needs(row(ask), false)).toBe(false);
    expect(result.current.needs(row(ask), true, "always")).toBe(false);
    expect(result.current.needs(row({ ...ask, toolName: "mcp__secrets__run" }), true)).toBe(false);
    result.current.open(row(ask));
    expect(open).toHaveBeenCalledWith("https://sign.weft.zip/approve?card=c1&pending=p1", "_blank", "noopener,noreferrer");
    result.current.open(row(null));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("answers on the board when no passkey browser is paired, or only a revoked one", async () => {
    const { result } = renderHook(() => useSignWindow(devices([{ passkey_id: null, revoked_at: null }, { passkey_id: "k", revoked_at: "t" }])));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.needs(row(ask), true)).toBe(false);
    const empty = renderHook(() => useSignWindow({ from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null }) }) }) } as never));
    await new Promise((r) => setTimeout(r, 0));
    expect(empty.result.current.needs(row(ask), true)).toBe(false);
  });
});
