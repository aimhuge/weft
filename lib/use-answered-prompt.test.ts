// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAnsweredPrompt } from "./use-answered-prompt";

type Props = { id?: string };
const start: Props = { id: "p1" };
const mount = () => renderHook(({ id }: Props) => useAnsweredPrompt(id), { initialProps: start });

describe("useAnsweredPrompt", () => {
  it("marks the prompt on screen answered, and not the next one", () => {
    const { result, rerender } = mount();
    expect(result.current.answered).toBe(false);
    act(() => result.current.setAnsweredId("p1"));
    expect(result.current.answered).toBe(true);
    rerender({ id: "p2" });
    expect(result.current.answered).toBe(false);
  });

  it("lets a prompt that left and came back be answered again", () => {
    const { result, rerender } = mount();
    act(() => result.current.setAnsweredId("p1"));
    rerender({});
    rerender({ id: "p1" });
    expect(result.current.answered).toBe(false);
  });
});
