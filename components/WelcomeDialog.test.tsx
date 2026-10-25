// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { REPLAY_EVENT } from "@/lib/welcome-client";
import type { WelcomeProject } from "@/lib/welcome-preview";

// The first-launch welcome (components/WelcomeDialog.tsx): the board's view of /api/welcome, with
// loadWelcome / answerWelcome and the CLI and card APIs faked and answerFor / defaultTicks kept real so the dialog answers
// with the ticks the user actually sees.

const api = vi.hoisted(() => ({
  loadWelcome: vi.fn(),
  answerWelcome: vi.fn(() => Promise.resolve({ welcome: { at: 0, countHistory: true, fresh: false, skip: [] } })),
  changeWelcome: vi.fn(),
}));
// Claude Code logged in, the others not: the usual first launch.
const CLAUDE_READY = { status: { claude: { loggedIn: true, email: "a@b.c" }, puku: { loggedIn: false }, codex: { loggedIn: false } }, runs: [] };
const client = vi.hoisted(() => ({
  loginStatus: vi.fn(),
  login: vi.fn(() => Promise.resolve({ login: null })),
  create: vi.fn(() => Promise.resolve({ card: { id: "card-1" } })),
  // The Get ready hero asks who's signed in, for its profile beat (components/WelcomeLoop.tsx).
  account: vi.fn(() => Promise.resolve<{ configured: boolean; user: { id: string; email: string } | null }>({ configured: false, user: null })),
  // puku-cli's Try free signs in to Weft (lib/auth/hooks.ts).
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth" })),
}));
vi.mock("@/lib/client", () => ({ api: client }));
const telemetry = vi.hoisted(() => ({ trackOnboarding: vi.fn() }));
vi.mock("@/lib/telemetry-client", () => ({ trackOnboarding: telemetry.trackOnboarding }));
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
  client.loginStatus.mockReset().mockResolvedValue(CLAUDE_READY);
  client.account.mockReset().mockResolvedValue({ configured: false, user: null });
  client.signIn.mockClear();
  telemetry.trackOnboarding.mockReset();
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

  it("with no agent logged in and signed out, puku-cli's row offers the free trial behind a GitHub sign-in", async () => {
    client.loginStatus.mockResolvedValue({ status: { claude: { loggedIn: false }, puku: { loggedIn: false }, codex: { loggedIn: false } }, runs: [] });
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await userEvent.click(await screen.findByRole("button", { name: /Try free/ }));
    expect(screen.getByText(/try it free with your Weft account/)).toBeInTheDocument();
    expect(screen.getByText("Log in to one, or try Puku free")).toBeInTheDocument();
    expect(client.signIn).toHaveBeenCalledWith("github", expect.anything());
    expect(telemetry.trackOnboarding).toHaveBeenCalledWith("onboarding_cli_login", { backend: "puku" });
  });

  it("signed in with no agent logged in, the first thread runs on puku-cli's trial", async () => {
    client.loginStatus.mockResolvedValue({ status: { claude: { loggedIn: false }, puku: { loggedIn: false }, codex: { loggedIn: false } }, runs: [] });
    client.account.mockResolvedValue({ configured: true, user: { id: "u1", email: "me@x.y" } });
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    expect(await screen.findByText("Ready · free trial on your Weft account")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try free/ })).toBeNull();
    await next();
    await bringIn();
    await userEvent.click(await screen.findByRole("button", { name: /Start thread/ }));
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ backend: "puku" }));
  });

  it("signed out, you sign in with GitHub after the video and before the projects", async () => {
    client.account.mockResolvedValue({ configured: true, user: null });
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    expect(await screen.findByRole("heading", { name: "Sign in to Weft" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Next ↵/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    expect(client.signIn).toHaveBeenCalledWith("github", expect.anything());

    client.account.mockResolvedValue({ configured: true, user: { id: "u1", email: "me@x.y" } });
    window.dispatchEvent(new Event("weft:account"));
    expect(await screen.findByText("me@x.y")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    await next();
    expect(await screen.findByRole("button", { name: /^Bring in/ })).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
  });

  it("already signed in, or with sign-in not set up, there is no sign-in screen", async () => {
    client.account.mockResolvedValue({ configured: true, user: { id: "u1", email: "me@x.y" } });
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await screen.findByText("Step 1 of 3");
    await next();
    expect(await screen.findByRole("button", { name: /^Bring in/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Weft" })).toBeNull();
  });

  it("starts the first thread in the first brought-in project on the ready CLI, then closes", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    await bringIn();
    await userEvent.click(await screen.findByRole("button", { name: /Fix a bug/ }));
    await userEvent.click(screen.getByRole("button", { name: /Start thread/ }));
    expect(client.create).toHaveBeenCalledWith({ prompt: "Find one real bug in this project and fix it.", cwd: "/repo/a", backend: "claude", start: true });
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it("Skip on the first thread closes without starting one", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    await bringIn();
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(client.create).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  // A replay is a preview you opened, so it dismisses like any dialog; first launch must not, or the answer is lost.
  // The dialog portals into document.body, so `container` never holds it — these ask the document.
  const dialogUp = () => Boolean(document.querySelector('[role="dialog"]'));
  const replayIt = async () => {
    api.loadWelcome.mockResolvedValue({ welcome: { at: 1, countHistory: true, fresh: false, skip: [] }, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await waitFor(() => expect(api.loadWelcome).toHaveBeenCalled());
    window.dispatchEvent(new Event(REPLAY_EVENT));
    expect(await screen.findByText("Replay · saves nothing")).toBeInTheDocument();
    expect(dialogUp()).toBe(true);
  };

  it("Escape closes a replay without answering", async () => {
    await replayIt();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialogUp()).toBe(false));
    expect(api.answerWelcome).not.toHaveBeenCalled();
  });

  it("a click outside the replay closes it", async () => {
    await replayIt();
    // The panel swallows presses inside itself; the backdrop around it is what closes (components/Modal.tsx).
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    await waitFor(() => expect(dialogUp()).toBe(false));
  });

  it("the replay's ✕ closes it", async () => {
    await replayIt();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialogUp()).toBe(false));
  });

  it("keeps the first launch open on Escape and a backdrop click", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    expect(await screen.findByText("Welcome to Weft", { selector: "h2" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(dialogUp()).toBe(true);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("a replay records no answer, and its skip says it was a replay", async () => {
    await replayIt();
    // A replay answers nothing, so it must not look like a first launch in the stats.
    await next();
    await bringIn();
    expect(telemetry.trackOnboarding).not.toHaveBeenCalledWith("onboarding_projects_answered", expect.anything());
    expect(api.answerWelcome).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(telemetry.trackOnboarding).toHaveBeenCalledWith("onboarding_skipped", { step: "first", replay: true });
  });

  it("a first launch records its answer", async () => {
    api.loadWelcome.mockResolvedValue({ welcome: null, preview: preview([project("/repo/a")]) });
    render(<WelcomeDialog />);
    await next();
    await bringIn();
    expect(telemetry.trackOnboarding).toHaveBeenCalledWith("onboarding_projects_answered", { brought: 1, count_history: true, start_empty: false });
  });
});
