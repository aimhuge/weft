// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnyOverlay } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";
import WeftShareDialog from "./WeftShareDialog";
import "./test-utils";

afterEach(cleanup);

function dialog(props: Partial<Parameters<typeof WeftShareDialog>[0]> = {}) {
  return (
    <WeftShareDialog title="Share it" url={null} onClose={() => {}} {...props}>
      body
    </WeftShareDialog>
  );
}

describe("WeftShareDialog", () => {
  it("draws on the body and hides the browser pane's page while open", () => {
    const pane = renderHook(() => useAnyOverlay());
    const { container, unmount } = render(dialog());
    expect(container.textContent).toBe("");
    expect(document.body.textContent).toContain("body");
    expect(pane.result.current).toBe(true);
    unmount();
    expect(pane.result.current).toBe(false);
  });

  it("offers Copy only once there's a url, with the extra after it", () => {
    render(dialog({ footerExtra: <button>Open</button> }));
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    cleanup();
    render(dialog({ url: "https://weft.zip/x", footerExtra: <button>Open</button> }));
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /copy/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps Weft's own layers from closing on the dialog's Escape", () => {
    const under = vi.fn();
    renderHook(() => useEscape(true, under));
    render(dialog());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(under).not.toHaveBeenCalled();
  });
});
