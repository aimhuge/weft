// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test-utils";
import AppEditButton from "./AppEditButton";
import { onNewThreadRequest } from "@/lib/new-thread-request";

const app = (url: string) => ({ id: "a", name: "📈 Growth", url, addedAt: 0 });

describe("AppEditButton", () => {
  it("asks for a New thread on a local app's folder", () => {
    const handle = vi.fn();
    const off = onNewThreadRequest(handle);
    render(<AppEditButton app={app("file:///Users/me/.weft/apps/growth/index.html")} />);
    fireEvent.click(screen.getByLabelText("Edit app"));
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ folder: "/Users/me/.weft/apps/growth" }));
    off();
  });

  it("renders nothing for a web app or no app", () => {
    const { container, rerender } = render(<AppEditButton app={app("https://example.com")} />);
    expect(container.innerHTML).toBe("");
    rerender(<AppEditButton app={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});
