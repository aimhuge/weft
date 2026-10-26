// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import { publishWaits, useWaitersOn, waitersOf } from "./waits-on";

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: id, prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

const waiting = (id: string, holderId: string) =>
  card(id, {
    emoji: "🧪",
    pending: { id: `p-${id}`, toolName: "Edit", title: "t", input: {}, waiting: true, why: { category: "same-code", detail: "d", holder: { id: holderId, title: holderId, claim: "/repo/%231/Login.tsx#Form" } } },
  });

describe("waitersOf", () => {
  it("lists the waiting cards by the card they wait on, skipping the rest", () => {
    const notWaiting = card("x", { pending: { id: "q", toolName: "Edit", title: "t", input: {} } });
    const map = waitersOf([waiting("a", "h"), waiting("b", "h"), notWaiting, card("y")]);
    expect([...map.keys()]).toEqual(["h"]);
    expect(map.get("h")).toEqual([
      { id: "a", title: "a", emoji: "🧪", thumb: undefined, pendingId: "p-a", file: "Login.tsx" },
      { id: "b", title: "b", emoji: "🧪", thumb: undefined, pendingId: "p-b", file: "Login.tsx" },
    ]);
  });
});

describe("useWaitersOn", () => {
  it("follows the published cards and re-renders only when the waits change", () => {
    publishWaits([]);
    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders++;
      return useWaitersOn("h");
    });
    expect(result.current).toEqual([]);
    act(() => publishWaits([waiting("a", "h")]));
    expect(result.current.map((w) => w.id)).toEqual(["a"]);
    const seen = renders;
    act(() => publishWaits([waiting("a", "h"), card("z")]));
    expect(renders).toBe(seen);
    act(() => publishWaits([]));
    expect(result.current).toEqual([]);
    unmount();
  });

  it("renders no waiters on the server", () => {
    publishWaits([waiting("a", "h")]);
    const Probe = () => createElement("i", null, useWaitersOn("h").length);
    expect(renderToString(createElement(Probe))).toBe("<i>0</i>");
    publishWaits([]);
  });
});
