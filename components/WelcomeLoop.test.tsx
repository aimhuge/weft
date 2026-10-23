// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { WelcomeLoop } from "./WelcomeLoop";

// The Get ready hero (components/WelcomeLoop.tsx): the live loop with your project names, or the still screenshot
// when the system asks for reduced motion.

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

afterEach(() => vi.unstubAllGlobals());

describe("WelcomeLoop", () => {
  it("plays the loop with your project names, sandboxed and out of the tab order", () => {
    motion(false);
    render(<WelcomeLoop projects={["weft", "deckcp"]} />);
    const frame = screen.getByTitle(/How Weft works/);
    expect(frame.getAttribute("src")).toBe("/welcome/loop.html?live=1&p=weft%2Cdeckcp");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the still board instead when reduced motion is on", () => {
    motion(true);
    render(<WelcomeLoop projects={[]} />);
    expect(screen.queryByTitle(/How Weft works/)).toBeNull();
    expect(screen.getByAltText(/A Weft board/)).toHaveAttribute("src", "/brand/faq/tour-board.jpg");
  });
});
