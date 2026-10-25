// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onIntroCovered } from "@/lib/intro-cover";
import Modal from "./Modal";
import "./test-utils";

afterEach(cleanup);

const backdrop = () => screen.getByRole("dialog").parentElement!;

describe("Modal layer", () => {
  it("stacks at z-50 by default", () => {
    render(<Modal label="Plain" onClose={() => {}}>body</Modal>);
    expect(backdrop().className).toContain("z-50");
  });

  it("stacks above feature intros on the top layer", () => {
    render(<Modal label="Top" layer="top" onClose={() => {}}>body</Modal>);
    expect(backdrop().className).toContain("z-[90]");
    expect(backdrop().className).not.toContain("z-50");
  });

  it("stacks the palette above the top layer, and the front layer (achievements) above both", () => {
    render(<Modal label="Palette" layer="palette" onClose={() => {}}>body</Modal>);
    expect(backdrop().className).toContain("z-[92]");
    cleanup();
    render(<Modal label="Front" layer="front" onClose={() => {}}>body</Modal>);
    expect(backdrop().className).toContain("z-[94]");
  });
});

describe("Modal over a feature intro", () => {
  it("tells the intros it came over them once, as it opens", () => {
    const covered = vi.fn();
    const off = onIntroCovered(covered);
    const { rerender } = render(<Modal label="Achievement" layer="front" onClose={() => {}}>one</Modal>);
    rerender(<Modal label="Achievement" layer="front" onClose={() => {}}>two</Modal>);
    expect(covered).toHaveBeenCalledTimes(1);
    off();
  });
});
