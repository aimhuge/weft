// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewCardInput } from "@/lib/client";
import { setBoardMode } from "@/lib/board-prefs";
import { NewCardTransportContext, type NewCardTransport } from "@/lib/new-card-transport";
import { setSimplePiece } from "@/lib/simple-mode";
import { forgetAgentList } from "@/lib/use-agents";
import "./test-utils";
import NewCardDialog from "./NewCardDialog";

// Simple mode's one-box New thread dialog (docs/architecture/simple-mode.md #3), laid out like the phone's new-card
// screen: project chips when no project is picked, the where and model pills over the composer, More for the rest.
const repo = (name: string, recentAt?: number) => ({ path: `/repo/${name}`, name, git: true, activity: 0, recentAt });
const api = vi.hoisted(() => ({
  settings: vi.fn(() => Promise.resolve({ defaultPermissionMode: "default", defaultBackend: "claude" })),
  warm: vi.fn(() => Promise.resolve()),
  agents: vi.fn(async () => ({ agents: (await import("@/lib/agents")).BUILT_IN_AGENTS, projects: {} })),
  repos: vi.fn(() => Promise.resolve({ repos: [] as ReturnType<typeof repo>[] })),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("@/lib/use-start-gate", () => ({ useStartGate: () => undefined }));
vi.mock("./Composer", () => import("./composer-mock"));
vi.mock("./RepoPicker", () => ({ default: ({ value }: { value: string }) => <span>Folder: {value}</span> }));

function setup(opts: { defaultCwd?: string; transport?: NewCardTransport } = {}) {
  const { transport } = opts;
  const defaultCwd = "defaultCwd" in opts ? opts.defaultCwd : "/repo/web";
  const onCreate = vi.fn<(input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>>(() => Promise.resolve());
  const dialog = <NewCardDialog home="/home" defaultCwd={defaultCwd} onCreate={onCreate} onClose={vi.fn()} />;
  const view = render(transport ? <NewCardTransportContext.Provider value={transport}>{dialog}</NewCardTransportContext.Provider> : dialog);
  return { onCreate, view, box: () => screen.getByRole("textbox", { name: "Message" }) };
}

const controlsShown = () => screen.queryByText(/^Folder: /) !== null;
const heading = () => screen.getByRole("heading").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  forgetAgentList();
});

afterEach(() => {
  setSimplePiece("one-box-new-card", undefined);
  document.cookie = "weft-board-mode=; path=/; max-age=0";
});

describe("NewCardDialog in simple mode", () => {
  it("keeps every control when the piece is off (advanced mode)", () => {
    setBoardMode("advanced");
    const { box } = setup();
    expect(controlsShown()).toBe(true);
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add to backlog/ })).toBeInTheDocument();
    expect(box()).toHaveAttribute("placeholder", expect.stringContaining("What should this thread do?"));
    expect(heading()).not.toContain(" in ");
  });

  it("shows the phone's layout when the piece is on: header, model pill, composer, Start", () => {
    setBoardMode("regular");
    const { box } = setup();
    expect(heading()).toContain("New thread");
    expect(heading()).toContain("in web");
    expect(controlsShown()).toBe(false);
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(box()).toHaveAttribute("placeholder", "What should it build?");
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to backlog/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Start now/ })).toBeInTheDocument();
    expect(api.repos).not.toHaveBeenCalled();
  });

  it("brings the controls back with More, keeping what was typed", async () => {
    setBoardMode("regular");
    const { box } = setup();
    await userEvent.type(box(), "fix the build");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(controlsShown()).toBe(true);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(box()).toHaveValue("fix the build");
    expect(screen.getByRole("button", { name: /Add to backlog/ })).toBeInTheDocument();
  });

  it("forgets More once the dialog closes", async () => {
    setSimplePiece("one-box-new-card", true);
    const first = setup();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    first.view.unmount();
    setup();
    expect(controlsShown()).toBe(false);
  });

  it("starts the thread with the dialog's own picks from Enter in the composer", async () => {
    setBoardMode("regular");
    const { onCreate, box } = setup();
    await userEvent.type(box(), "fix the build{Enter}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "fix the build", cwd: "/repo/web", start: true }));
  });

  it("offers project chips when no project is picked, and a chip picks the folder", async () => {
    setBoardMode("regular");
    api.repos.mockResolvedValueOnce({ repos: [repo("api"), repo("site", 2)] });
    const { onCreate, box } = setup({ defaultCwd: undefined });
    expect(await screen.findByText("Project")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter projects")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "api" }));
    expect(screen.getByRole("button", { name: "api" })).toHaveAttribute("aria-pressed", "true");
    expect(heading()).toContain("in api");
    await userEvent.type(box(), "go{Enter}");
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo/api" }));
  });

  it("filters the chips when there are many", async () => {
    setBoardMode("regular");
    api.repos.mockResolvedValueOnce({ repos: ["a1", "b2", "c3", "d4", "e5", "weft"].map((n) => repo(n)) });
    setup({ defaultCwd: undefined });
    const filter = await screen.findByLabelText("Filter projects");
    await userEvent.type(filter, "wef");
    expect(screen.getByRole("button", { name: "weft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "a1" })).toBeNull();
    await userEvent.clear(filter);
    await userEvent.type(filter, "zzz");
    expect(screen.getByText(/No projects match/)).toBeInTheDocument();
  });

  it("shows no chips when the repos don't load", async () => {
    setBoardMode("regular");
    api.repos.mockRejectedValueOnce(new Error("down"));
    setup({ defaultCwd: undefined });
    await vi.waitFor(() => expect(api.repos).toHaveBeenCalled());
    expect(screen.queryByText("Project")).toBeNull();
  });

  it("shows the where pill on weft.zip when there's more than one place, and no chips", () => {
    setBoardMode("regular");
    const places = [
      { device: "mac-1", folder: "/repo/web", label: "web" },
      { device: "worker:w1", folder: "ling", label: "ling" },
    ];
    setup({ defaultCwd: "mac-1\n/repo/web", transport: { local: false, places, note: "Runs on your Mac" } });
    expect(screen.getByLabelText(/Where it runs/)).toBeInTheDocument();
    expect(heading()).toContain("in web");
    expect(screen.queryByText("Runs on your Mac")).toBeNull();
  });
});
