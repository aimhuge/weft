// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubFolder, GithubStatus } from "@/lib/github-view";
import "./test-utils";

const api = vi.hoisted(() => ({
  importIssues: vi.fn(() => Promise.resolve({ folder: "/dev/app", added: 2, updated: 0, archived: 0 })),
  stopIssues: vi.fn(() => Promise.resolve({ folders: [] })),
  addHook: vi.fn(() => Promise.resolve({ repo: "acme/app" })),
  removeHook: vi.fn(() => Promise.resolve({ ok: true })),
  setIssueWorkflow: vi.fn((folder: string, workflow: unknown) => Promise.resolve({ folder, workflow })),
  skills: vi.fn(() => Promise.resolve({ skills: [{ name: "weft:plan", description: "Makes a plan" }] })),
  agents: vi.fn(() => Promise.resolve({ agents: [{ id: "triage", name: "Triage", emoji: "🔍", tagline: "Checks the issue" }] })),
  designAgent: vi.fn(() => Promise.resolve({ card: { id: "card-1", title: "Design an agent for app" }, start: { started: true } })),
}));
vi.mock("@/lib/client", () => ({ api }));

const { default: GithubDrawer } = await import("./GithubDrawer");

const folder = (path: string, over: Partial<GithubFolder> = {}): GithubFolder => ({ folder: path, repo: null, error: null, syncing: false, last: null, instant: false, workflow: { landing: "backlog" }, ...over });
const signedIn = (folders: GithubFolder[]): GithubStatus => ({ account: { login: "fotoflo", url: "https://github.com/fotoflo" }, error: null, weft: true, instantError: null, folders });

function setup(status: GithubStatus | null, project: string | null = null, error: string | null = null) {
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  const onOpenCard = vi.fn();
  const openExternal = vi.fn();
  (window as unknown as { weft: unknown }).weft = { openExternal };
  render(<GithubDrawer status={status} error={error} reload={reload} project={project} onOpenUrl={onOpenUrl} onOpenCard={onOpenCard} notify={notify} />);
  return { reload, notify, onOpenUrl, onOpenCard, openExternal };
}

// A drawer whose reload brings the server's answer back, the way the real one does: the workflow a
// folder was given is what the next draw shows.
function setupLive(folders: GithubFolder[]) {
  const current = { folders };
  const notify = vi.fn();
  const onOpenCard = vi.fn();
  const reload = vi.fn(() => {
    rerender(<GithubDrawer status={signedIn(current.folders)} error={null} reload={reload} project={null} onOpenUrl={vi.fn()} onOpenCard={onOpenCard} notify={notify} />);
    return Promise.resolve();
  });
  const { rerender } = render(<GithubDrawer status={signedIn(current.folders)} error={null} reload={reload} project={null} onOpenUrl={vi.fn()} onOpenCard={onOpenCard} notify={notify} />);
  api.setIssueWorkflow.mockImplementation((folder: string, workflow: unknown) => {
    current.folders = current.folders.map((f) => (f.folder === folder ? { ...f, workflow: workflow as GithubFolder["workflow"] } : f));
    return Promise.resolve({ folder, workflow });
  });
  return { reload, notify, onOpenCard };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks drops the implementations the hoisted factory gave the api mocks.
  api.importIssues.mockImplementation(() => Promise.resolve({ folder: "/dev/app", added: 2, updated: 0, archived: 0 }));
  api.stopIssues.mockImplementation(() => Promise.resolve({ folders: [] }));
  api.addHook.mockImplementation(() => Promise.resolve({ repo: "acme/app" }));
  api.removeHook.mockImplementation(() => Promise.resolve({ ok: true }));
  api.setIssueWorkflow.mockImplementation((folder: string, workflow: unknown) => Promise.resolve({ folder, workflow }));
  api.skills.mockImplementation(() => Promise.resolve({ skills: [{ name: "weft:plan", description: "Makes a plan" }] }));
  api.agents.mockImplementation(() => Promise.resolve({ agents: [{ id: "triage", name: "Triage", emoji: "🔍", tagline: "Checks the issue" }] }));
  api.designAgent.mockImplementation(() => Promise.resolve({ card: { id: "card-1", title: "Design an agent for app" }, start: { started: true } }));
});
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("GithubDrawer", () => {
  it("says it's loading, or what went wrong", () => {
    setup(null);
    expect(screen.getByText("Asking GitHub…")).toBeInTheDocument();
  });

  it("shows a load error", () => {
    setup(null, null, "Server down");
    expect(screen.getByText("Server down")).toBeInTheDocument();
  });

  it("walks a signed-out gh through signing in, and checks again", async () => {
    const { reload, openExternal } = setup({ account: null, error: "The GitHub CLI isn't logged in. Run gh auth login.", weft: false, instantError: null, folders: [] });
    expect(screen.getByText("gh auth login --web")).toBeInTheDocument();
    expect(screen.queryByText("brew install gh")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(reload).toHaveBeenCalled();
    await userEvent.click(screen.getByText("GitHub CLI"));
    expect(openExternal).toHaveBeenCalledWith("https://cli.github.com");
  });

  it("asks for gh to be installed when it's missing", () => {
    setup({ account: null, error: "The GitHub CLI isn't installed. brew install gh, then gh auth login.", weft: false, instantError: null, folders: [] });
    expect(screen.getByText("brew install gh")).toBeInTheDocument();
  });

  it("shows the account, a folder with no remote, and the repo links", async () => {
    const { onOpenUrl } = setup(signedIn([folder("/dev/app", { repo: "acme/app" }), folder("/dev/notes", { error: "notes has no GitHub remote" })]));
    expect(screen.getByText("notes has no GitHub remote")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "@fotoflo" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/fotoflo");
    await userEvent.click(screen.getByRole("button", { name: /acme\/app/ }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/acme/app");
    await userEvent.click(screen.getByRole("button", { name: "Issues" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/acme/app/issues");
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
  });

  it("turns a folder's issue sync on, syncing it now", async () => {
    const { reload, notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app" })]));
    await userEvent.click(screen.getByRole("checkbox", { name: /Issues → Backlog/ }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.importIssues).toHaveBeenCalledWith("/dev/app");
    expect(notify).toHaveBeenCalledWith("GitHub issues for app: 2 added");
  });

  it("syncs now and turns sync off on a synced folder", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, last: { at: Date.now(), counts: { added: 0, updated: 1, archived: 0 } } })]));
    expect(screen.getByText(/1 updated/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.importIssues).toHaveBeenCalledWith("/dev/app"));
    await userEvent.click(screen.getByRole("checkbox", { name: /Issues → Backlog/ }));
    await waitFor(() => expect(api.stopIssues).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenLastCalledWith("Stopped syncing GitHub issues for app; its cards stay");
  });

  it("toasts a failed sync and shows a sync error", async () => {
    api.importIssues.mockRejectedValueOnce(new Error("rate limited"));
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, last: { at: 1, error: "gh broke" } })]));
    expect(screen.getByText("gh broke")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("rate limited")));
  });

  it("shows only the top bar's project, and says when there are none", () => {
    setup(signedIn([folder("/dev/app", { repo: "acme/app" }), folder("/dev/web", { repo: "acme/web" })]), "/dev/web");
    expect(screen.queryByText("acme/app")).not.toBeInTheDocument();
    expect(screen.getByText("acme/web")).toBeInTheDocument();
  });

  it("asks for a project when the board has none", () => {
    setup(signedIn([]));
    expect(screen.getByText(/Add a project to the board/)).toBeInTheDocument();
  });

  it("turns instant updates on and off for a synced folder", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true })]));
    expect(screen.getByText("Syncing every 5 minutes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Instant, by webhook" }));
    await waitFor(() => expect(api.addHook).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenCalledWith("acme/app now sends its issue changes to Weft as they happen");
  });

  it("takes a webhook off", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, instant: true })]));
    expect(screen.getByText("Syncing as issues change")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Instant, by webhook" }));
    await waitFor(() => expect(api.removeHook).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenCalledWith("Took the webhook off acme/app; it syncs every 5 minutes");
  });

  it("asks for a Weft sign-in before instant updates, and shows a webhook read error", () => {
    setup({ ...signedIn([folder("/dev/app", { repo: "acme/app", syncing: true })]), weft: false, instantError: "Couldn't read your webhooks: offline" });
    expect(screen.getByRole("checkbox", { name: "Instant: sign in to Weft first" })).toBeDisabled();
    expect(screen.getByText("Couldn't read your webhooks: offline")).toBeInTheDocument();
  });
});

describe("the project's workflow", () => {
  it("shows where the cards land, and only offers the workflow once a folder syncs", () => {
    setup(signedIn([folder("/dev/app", { repo: "acme/app" })]));
    expect(screen.getByRole("checkbox", { name: /Issues → Backlog/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Where issue cards land" })).not.toBeInTheDocument();
  });

  it("sends the cards to Needs you when the project asks for that", async () => {
    const { notify } = setupLive([folder("/dev/app", { repo: "acme/app", syncing: true })]);
    await userEvent.click(screen.getByRole("button", { name: "Needs you" }));
    await waitFor(() => expect(api.setIssueWorkflow).toHaveBeenCalledWith("/dev/app", { landing: "needs_you" }));
    expect(notify).toHaveBeenCalledWith("New issues for app land in Needs you");
  });

  it("says what a run card does, and offers the skill and the agent", async () => {
    const { notify } = setupLive([folder("/dev/app", { repo: "acme/app", syncing: true })]);
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(api.setIssueWorkflow).toHaveBeenCalledWith("/dev/app", { landing: "run" }));
    expect(notify).toHaveBeenCalledWith("New issues for app run on their own");
    expect(screen.getByRole("button", { name: /Checks with/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Works as/ })).toBeInTheDocument();
  });

  it("picks the skill that validates the card first", async () => {
    setupLive([folder("/dev/app", { repo: "acme/app", syncing: true, workflow: { landing: "run" } })]);
    await userEvent.click(screen.getByRole("button", { name: /Checks with/ }));
    await waitFor(() => expect(screen.getByText("weft:plan")).toBeInTheDocument());
    await userEvent.click(screen.getByText("weft:plan"));
    await waitFor(() => expect(api.setIssueWorkflow).toHaveBeenCalledWith("/dev/app", { landing: "run", skill: "weft:plan" }));
  });

  it("picks the agent that works the card", async () => {
    setupLive([folder("/dev/app", { repo: "acme/app", syncing: true, workflow: { landing: "run" } })]);
    await userEvent.click(screen.getByRole("button", { name: /Works as/ }));
    await waitFor(() => expect(screen.getByText(/Triage/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Triage/));
    await waitFor(() => expect(api.setIssueWorkflow).toHaveBeenCalledWith("/dev/app", { landing: "run", agent: "triage" }));
  });

  it("designs the agent with a new thread, and opens it", async () => {
    const { notify, onOpenCard } = setupLive([folder("/dev/app", { repo: "acme/app", syncing: true, workflow: { landing: "run" } })]);
    await userEvent.click(screen.getByRole("button", { name: "Design the agent" }));
    await waitFor(() => expect(api.designAgent).toHaveBeenCalledWith({ project: "/dev/app", job: "triages this project's GitHub issues" }));
    await waitFor(() => expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" })));
    expect(notify).toHaveBeenCalledWith("A thread is designing the agent for app");
  });

  it("makes one thread, not two, when the button is clicked twice", async () => {
    setupLive([folder("/dev/app", { repo: "acme/app", syncing: true, workflow: { landing: "run" } })]);
    const button = screen.getByRole("button", { name: "Design the agent" });
    await userEvent.dblClick(button);
    await waitFor(() => expect(api.designAgent).toHaveBeenCalledTimes(1));
  });
});
