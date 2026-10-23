// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { WelcomeProject } from "@/lib/welcome-preview";

// The first-launch welcome (components/WelcomeDialog.tsx): the board's view of /api/welcome, with
// loadWelcome / answerWelcome and the CLI and card APIs faked and answerFor / defaultTicks kept real so the dialog answers
// with the ticks the user actually sees.

const api = vi.hoisted(() => ({
  loadWelcome: vi.fn(),
  answerWelcome: vi.fn(() => Promise.resolve({ welcome: { at: 0, countHistory: true, fresh: false, skip: [] } })),
  changeWelcome: vi.fn(),
}));
const client = vi.hoisted(() => ({
  loginStatus: vi.fn(() => Promise.resolve({ status: { claude: { loggedIn: true, email: "a@b.c" }, puku: { loggedIn: false }, codex: { loggedIn: false } }, runs: [] })),
  login: vi.fn(() => Promise.resolve({ login: null })),
  create: vi.fn(() => Promise.resolve({ card: { id: "card-1" } })),
  // The Get ready hero asks who's signed in, for its profile beat (components/WelcomeLoop.tsx).
  account: vi.fn(() => Promise.resolve({ configured: false, user: null })),
}));
vi.mock("@/lib/client", () => ({ api: client }));
vi.mock("@/lib/welcome-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/welcome-client")>("@/lib/welcome-client");
  return { ...actual, loadWelcome: api.loadWelcome, answerWelcome: api.answerWelcome, changeWelcome: api.changeWelcome };
});

const { default: WelcomeDialog } = await import("./WelcomeDialog");

const project = (cwd: string, scratch = false): WelcomeProject => ({
  cwd,
  name: cwd.split("/").pop() || cwd,
  where: cwd,
  sessions: 1,
  last: 1,
  scratch,
});

const preview = (projects: WelcomeProject[], github: unknown = null) => ({
  projects,
  profile: {
    className: "Finisher",
    level: { level: 1, title: "Thread", floor: 0, next: 100 },
    xp: 10,
    sessions: projects.length,
    shipped: 0,
    bestStreak: 0,
    projects: 1,
    top: [],
  },
  github,
});

function setup() {
  api.loadWelcome.mockReset();
  api.answerWelcome.mockReset().mockResolvedValue({ welcome: { at: 0, countHistory: true, fresh: false, skip: [] } });
  api.changeWelcome.mockReset();
  client.create.mockClear();
  client.login.mockClear();
}

// Screen 1 is Get ready (the CLIs); Next goes to the projects, or straight to the first thread with no history.
const next = async () => userEvent.click(await screen.findByRole("button", { name: /^Next ↵/ }));
const bringIn = async () => userEvent.click(await screen.findByRole("button", { name: /^Bring in/ }));

beforeEach(setup);
afterEach(() => {
  vi.useRealTimers();
});

describe("WelcomeDialog", () => {
  it("renders nothing when the welcome is already answered", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: { at: 1, countHistory: true, fresh: false, skip: [] } });
    const { container } = render(<WelcomeDialog />);
    await waitFor(() => expect(api.loadWelcome).toHaveBeenCalled());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows to a new user with no history too, and answers on leaving screen 1", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([]) });
    render(<WelcomeDialog />);
    expect(await screen.findByText("Welcome to Weft", { selector: "h2" })).toBeInTheDocument();
    expect(api.answerWelcome).not.toHaveBeenCalled();
    await next();
    expect(api.answerWelcome).toHaveBeenCalledWith({ countHistory: true, fresh: false, skip: [] });
    expect(await screen.findByText("Start your first thread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose a folder/ })).toBeInTheDocument();
  });

  it("screen 1 shows each CLI's login and offers Log in for one that isn't", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    expect(await screen.findByText(/Ready · a@b.c/)).toBeInTheDocument();
    expect(screen.getByText(/Ready to run threads/)).toBeInTheDocument();
    const logIns = screen.getAllByRole("button", { name: /Log in/ });
    expect(logIns).toHaveLength(2);
    await userEvent.click(logIns[0]!);
    expect(client.login).toHaveBeenCalledWith("puku", "start");
  });

  it("Bring in with the default ticks sends an empty skip list and moves to the first thread", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a"), project("/repo/b")]) });
    render(<WelcomeDialog />);
    await next();
    expect(await screen.findByText("Bring in your projects")).toBeInTheDocument();
    await bringIn();
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: false, skip: [] });
    expect(await screen.findByText("Start your first thread")).toBeInTheDocument();
  });

  it("unticking the history switch sends countHistory false", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Count my past sessions/ }));
    await bringIn();
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: false, fresh: false, skip: [] });
  });

  it("Start empty sends fresh true and an empty skip list", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    await userEvent.click(await screen.findByRole("button", { name: "Start empty" }));
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: true, skip: [] });
  });

  it("toggles a project off, then Bring in sends the unticked folder in skip", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a"), project("/repo/b")]) });
    render(<WelcomeDialog />);
    await next();
    await userEvent.click(await screen.findByRole("checkbox", { name: /\/repo\/b/ }));
    await bringIn();
    expect(api.answerWelcome).toHaveBeenLastCalledWith({ countHistory: true, fresh: false, skip: ["/repo/b"] });
  });

  it("scratch projects are unticked and folded under a count", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/real"), project("/tmp/wt", true), project("/tmp/wt2", true)]) });
    render(<WelcomeDialog />);
    await next();
    const collapse = await screen.findByRole("button", { name: /scratch/ });
    expect(collapse).toHaveTextContent("2 scratch, temp and worktree folders left out");
    // One project checkbox plus the history switch.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await userEvent.click(collapse);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("Enter on a checkbox presses Bring in", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    const checkbox = await screen.findByRole("checkbox", { name: /\/repo\/a/ });
    checkbox.focus();
    await userEvent.keyboard("{Enter}");
    expect(api.answerWelcome).toHaveBeenCalled();
  });

  it("starts the first thread in the first brought-in project on the ready CLI, then closes", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    const { container } = render(<WelcomeDialog />);
    await next();
    await bringIn();
    await userEvent.click(await screen.findByRole("button", { name: /Fix a bug/ }));
    await userEvent.click(screen.getByRole("button", { name: /Start thread/ }));
    expect(client.create).toHaveBeenCalledWith({ prompt: "Find one real bug in this project and fix it.", cwd: "/repo/a", backend: "claude", start: true });
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });

  it("Skip on the first thread closes without starting one", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    const { container } = render(<WelcomeDialog />);
    await next();
    await bringIn();
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(client.create).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });
});
