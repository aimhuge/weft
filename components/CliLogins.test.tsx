// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend, CliStatus, LoginView } from "@/lib/types";
import "./test-utils";
import CliLogins from "./CliLogins";

const api = vi.hoisted(() => ({
  loginStatus: vi.fn<() => Promise<{ status: Record<Backend, CliStatus>; runs: LoginView[] }>>(),
  login: vi.fn<(backend: Backend, action: "start") => Promise<{ login: LoginView | null }>>(),
}));
vi.mock("@/lib/client", () => ({ api }));

const out: CliStatus = { loggedIn: false };
const in_: CliStatus = { loggedIn: true, email: "ada@b.co" };

function status(over: Partial<Record<Backend, CliStatus>> = {}) {
  return {
    status: { claude: out, puku: out, codex: out, ...over } as Record<Backend, CliStatus>,
    runs: [] as LoginView[],
  };
}

function run(backend: Backend, state: LoginView["state"] = "running"): LoginView {
  return { backend, state, output: "", startedAt: Date.now() };
}

// The text of the row a button sits in, so a test can tell the CLIs apart.
function rowText(button: HTMLElement): string {
  return button.parentElement?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  api.loginStatus.mockResolvedValue(status());
  api.login.mockResolvedValue({ login: null });
});

function setup() {
  render(<CliLogins titleClass="" />);
}

describe("CliLogins", () => {
  // GitHub issue #13: the panel read the logins once and then went on saying "Not logged in"
  // after a successful login, so the user pressed Log in again and the UI got stuck.
  it("shows a CLI that has logged in", async () => {
    api.loginStatus.mockResolvedValue(status({ claude: in_ }));
    setup();
    expect(await screen.findByText("Logged in as ada@b.co")).toBeInTheDocument();
    // Claude Code no longer needs a Log in button; the other two CLIs still do.
    expect(screen.getAllByRole("button", { name: /Log in/ })).toHaveLength(2);
  });

  it("reads the logins again on a timer, so a login finished elsewhere shows up", async () => {
    vi.useFakeTimers();
    try {
      api.loginStatus.mockResolvedValue(status());
      setup();
      await vi.waitFor(() => expect(api.loginStatus).toHaveBeenCalledTimes(1));

      // The login finished in the browser; the panel looks again and sees it.
      api.loginStatus.mockResolvedValue(status({ claude: in_ }));
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(api.loginStatus).toHaveBeenCalledTimes(2));
      expect(screen.getByText("Logged in as ada@b.co")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers Log in for a CLI that isn't logged in", async () => {
    setup();
    expect(await screen.findAllByText("Not logged in")).toHaveLength(3);
    const buttons = screen.getAllByRole("button", { name: /Log in/ });
    expect(buttons).toHaveLength(3);
  });

  it("starts a login when Log in is pressed", async () => {
    setup();
    const buttons = await screen.findAllByRole("button", { name: /Log in/ });
    const claude = buttons.find((b) => rowText(b).startsWith("Claude Code"));
    expect(claude).toBeDefined();
    await userEvent.click(claude!);
    await waitFor(() => expect(api.login).toHaveBeenCalledWith("claude", "start"));
  });

  // The second click is what used to freeze the UI. While the server is running the login, the
  // button is gone, so it can't be pressed twice.
  it("shows the login as running instead of a Log in button", async () => {
    api.loginStatus.mockResolvedValue({ ...status(), runs: [run("claude")] });
    setup();
    expect(await screen.findByText("Logging in")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /Log in/ });
    // The other two CLIs still have theirs; Claude Code's is gone.
    expect(buttons).toHaveLength(2);
    expect(buttons.some((b) => rowText(b).startsWith("Claude Code"))).toBe(false);
  });

  it("says when the logins can't be checked", async () => {
    api.loginStatus.mockRejectedValue(new Error("no route to host"));
    setup();
    expect(await screen.findByText(/Couldn't check logins/)).toBeInTheDocument();
  });
});
