// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test-utils";

// components/team/OpenUpgrade.tsx: a pricing card's link lands on the billing page, which opens the upgrade dialog.

const { openUpgrade } = vi.hoisted(() => ({ openUpgrade: vi.fn() }));
vi.mock("@/lib/use-upgrade", () => ({ openUpgrade }));

import OpenUpgrade from "./OpenUpgrade";

afterEach(() => vi.clearAllMocks());

describe("OpenUpgrade", () => {
  it("opens the plan picker once, and draws nothing", () => {
    const { container, rerender } = render(<OpenUpgrade />);
    rerender(<OpenUpgrade />);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
    expect(openUpgrade).toHaveBeenCalledWith("plan");
    expect(container.innerHTML).toBe("");
  });
});
