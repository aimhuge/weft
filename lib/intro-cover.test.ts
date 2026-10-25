import { describe, expect, it, vi } from "vitest";
import { coverIntros, onIntroCovered } from "./intro-cover";

describe("intro-cover", () => {
  it("tells every intro listening that something came over it, until it stops listening", () => {
    const one = vi.fn();
    const two = vi.fn();
    const offOne = onIntroCovered(one);
    const offTwo = onIntroCovered(two);
    coverIntros();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);

    offOne();
    coverIntros();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(2);
    offTwo();
  });
});
