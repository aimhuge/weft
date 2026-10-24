// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import IsolateToggle from "./IsolateToggle";

afterEach(cleanup);

describe("IsolateToggle", () => {
  it("reads Shared, Isolate? when suggested, and Isolated when on", () => {
    const { rerender } = render(<IsolateToggle on={false} suggest={false} onToggle={() => {}} />);
    expect(screen.getByRole("switch", { name: "Isolated" }).textContent).toContain("Shared");
    rerender(<IsolateToggle on={false} suggest onToggle={() => {}} />);
    expect(screen.getByRole("switch").textContent).toContain("Isolate?");
    rerender(<IsolateToggle on suggest onToggle={() => {}} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch").textContent).toContain("Isolated");
  });

  it("toggles on click", async () => {
    const onToggle = vi.fn();
    render(<IsolateToggle on={false} suggest={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
