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

describe("Modal's place in the page", () => {
  it("draws on the body's end, not where it was asked for", () => {
    // A dialog opened from the header sits inside <header>, and on the Mac that header is the window's
    // drag region, which is a stacking context: the dialog's fixed backdrop could only stack inside it,
    // under the board's sheet and the rail's drawer beside it. Out on the body there is none in the way.
    render(
      <header>
        <Modal label="Leagues" onClose={() => {}}>body</Modal>
      </header>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest("body")).not.toBeNull();
    expect(dialog.closest("header")).toBeNull();
    // Its own div on the body, so one dialog's unmount can't take another's nodes with it.
    expect(dialog.closest("[data-weft-modal]")!.parentElement).toBe(document.body);
  });

  it("takes its host away with it", () => {
    const { unmount } = render(<Modal label="Leagues" onClose={() => {}}>body</Modal>);
    expect(document.querySelectorAll("[data-weft-modal]")).toHaveLength(1);
    unmount();
    expect(document.querySelectorAll("[data-weft-modal]")).toHaveLength(0);
  });

  it("leaves one host behind when StrictMode runs the initializer twice", async () => {
    // StrictMode calls a lazy initializer twice on the same mount. Two hosts meant React portaled
    // into one the cleanup took away, so the dialog never painted (the Settings window stayed shut).
    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <Modal label="Strict" onClose={() => {}}>body</Modal>
      </StrictMode>,
    );
    expect(document.querySelectorAll("[data-weft-modal]")).toHaveLength(1);
    // The dialog is on the page, not in a host the cleanup took away.
    expect(screen.getByRole("dialog").closest("[data-weft-modal]")!.isConnected).toBe(true);
  });
});
