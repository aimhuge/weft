// @vitest-environment jsdom
// Settings → Connectors → GitHub on your workers (components/GitHubConnector.tsx), over a stub of its hook.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "./test-utils";

const c = vi.hoisted((): { current: Record<string, unknown> } => ({ current: {} }));
vi.mock("@/lib/use-worker-connectors", () => ({ useWorkerConnectors: () => c.current }));
const { default: GitHubConnector } = await import("./GitHubConnector");

const stub = (github: Record<string, unknown> | null, more: Record<string, unknown> = {}) => {
  const connect = vi.fn();
  const disconnect = vi.fn(() => Promise.resolve());
  c.current = { view: github ? { signedIn: true, github } : { signedIn: false, github: { connected: false } }, note: null, error: null, connect, disconnect, ...more };
  return { connect, disconnect };
};
const show = () => render(<GitHubConnector titleClass="t" hintClass="h" />);

describe("GitHubConnector", () => {
  it("shows nothing signed out", () => {
    stub(null);
    const { container } = show();
    expect(container.textContent).toBe("");
  });

  it("offers Connect GitHub until it's connected, and says workers get it when paired", () => {
    const s = stub({ connected: false });
    show();
    expect(screen.getByText(/Each worker you add gets it when you pair it/)).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
    expect(s.connect).toHaveBeenCalled();
  });

  it("says why it couldn't read, and as whom it's connected", () => {
    stub({ connected: false, error: "Couldn't reach weft.zip." });
    const a = show();
    expect(screen.getByText("Couldn't reach weft.zip.")).toBeTruthy();
    a.unmount();
    const s = stub({ connected: true, login: "ada" }, { note: "Done.", error: "Oops" });
    show();
    expect(screen.getByText("Connected as @ada")).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
    expect(screen.getByText("Oops")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(s.disconnect).toHaveBeenCalled();
  });

  it("says Connected with no login", () => {
    stub({ connected: true });
    show();
    expect(screen.getByText("Connected")).toBeTruthy();
  });
});
