// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localTransport, ThreadTransportContext } from "@/lib/thread-transport";
import type { Card } from "@/lib/types";
import { publishWaits } from "@/lib/waits-on";
import YouFirst from "./YouFirst";
import "./test-utils";

const waiting: Card = {
  id: "a", title: "Fix login", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, emoji: "🔐",
  pending: { id: "p1", toolName: "Edit", title: "t", input: {}, waiting: true, why: { category: "same-code", detail: "d", holder: { id: "b", title: "Restyle", claim: "/repo/Login.tsx#Form" } } },
};

afterEach(() => act(() => publishWaits([])));

describe("YouFirst", () => {
  it("shows a card waiting on this thread and puts it first", async () => {
    const putFirst = vi.fn(() => Promise.resolve());
    act(() => publishWaits([waiting]));
    render(
      <ThreadTransportContext.Provider value={{ ...localTransport, putFirst }}>
        <YouFirst cardId="b" />
      </ThreadTransportContext.Provider>,
    );
    expect(screen.getByText("Login.tsx")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Fix login" }).textContent).toBe("🔐");
    await userEvent.click(screen.getByRole("button", { name: "You first" }));
    expect(putFirst).toHaveBeenCalledWith("a", "p1");
  });

  it("shows nothing when no one waits, or where the transport can't put a card first", () => {
    const { container, rerender } = render(<YouFirst cardId="b" />);
    expect(container.textContent).toBe("");
    act(() => publishWaits([waiting]));
    rerender(
      <ThreadTransportContext.Provider value={{ ...localTransport, putFirst: undefined }}>
        <YouFirst cardId="b" />
      </ThreadTransportContext.Provider>,
    );
    expect(container.textContent).toBe("");
  });
});
