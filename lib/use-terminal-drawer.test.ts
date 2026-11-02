// @vitest-environment jsdom
// The terminal drawer opens only when you toggle it: picking a worker card (or loading the board) never opens a worker's
// terminal, which would ask Touch ID and start a shell on another machine. This Mac's folders still follow the board.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { drawerShown, remoteTarget, useTerminalDrawer, type TerminalDrawerInput } from "./use-terminal-drawer";

const projects = [{ path: "worker://w1/ling", worker: "m1mini" }] as unknown as TerminalDrawerInput["projects"];
const at = (cwd: string, over: Partial<TerminalDrawerInput> = {}): TerminalDrawerInput => ({ cwd, openWorker: null, project: null, projects, cardOpen: true, ...over });

describe("remoteTarget and drawerShown", () => {
  it("names a worker folder or an away notice, and nothing for this Mac", () => {
    expect(remoteTarget("/r", null)).toBeNull();
    expect(remoteTarget("worker://w1/ling", null)).toBe("worker://w1/ling");
    expect(remoteTarget("/home", "m2")).toBe("away:m2");
    expect(drawerShown(true, null, "worker://w1/ling")).toBe(true);
    expect(drawerShown(true, "worker://w1/ling", null)).toBe(false);
    expect(drawerShown(true, "worker://w1/ling", "worker://w1/ling")).toBe(true);
    expect(drawerShown(false, null, null)).toBe(false);
  });
});

describe("useTerminalDrawer", () => {
  it("starts closed, and switching to a worker card with the drawer open hides it rather than opening that terminal", () => {
    const { result, rerender } = renderHook((input: TerminalDrawerInput) => useTerminalDrawer(input), { initialProps: at("/r") });
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    rerender(at("/other"));
    expect(result.current.open).toBe(true);
    rerender(at("worker://w1/ling"));
    expect(result.current.open).toBe(false);
    expect(result.current.host).toBe("m1mini");
    rerender(at("/r"));
    expect(result.current.open).toBe(true);
  });

  it("opens a worker's terminal on your toggle, for that worker only", () => {
    const { result, rerender } = renderHook((input: TerminalDrawerInput) => useTerminalDrawer(input), { initialProps: at("worker://w1/ling") });
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    rerender(at("worker://w1/site"));
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    act(() => result.current.setHeight(300));
    expect(result.current.height).toBe(300);
  });

  it("treats the away notice like a worker's terminal", () => {
    const { result, rerender } = renderHook((input: TerminalDrawerInput) => useTerminalDrawer(input), { initialProps: at("/r") });
    act(() => result.current.toggle());
    rerender(at("/home", { openWorker: { name: "m2" } }));
    expect(result.current.away).toBe("m2");
    expect(result.current.open).toBe(false);
  });
});
