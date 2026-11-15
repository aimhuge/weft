// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, ServiceEntry } from "@/lib/types";

vi.mock("@/lib/use-now", () => ({ useNow: () => 17 * 60_000 }));

// Track the setServicesRefreshMs calls so we can assert the drawer wired the select to the prefs.
const setRefresh = vi.hoisted(() => vi.fn<(ms: number) => void>());
vi.mock("@/lib/services-prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services-prefs")>();
  return {
    ...actual,
    REFRESH_CHOICES: actual.REFRESH_CHOICES,
    refreshLabel: actual.refreshLabel,
    servicesRefreshMs: () => actual.DEFAULT_REFRESH_MS,
    subscribeServicesRefresh: () => () => {},
    setServicesRefreshMs: (ms: number) => setRefresh(ms),
  };
});

const { default: ServicesDrawer } = await import("./ServicesDrawer");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const proc = (over: Partial<ServiceEntry["procs"][number]> = {}): ServiceEntry["procs"][number] => ({ pid: 100, ppid: 1, cpu: 1.2, memKb: 4096, command: "claude", ...over });
const svc = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({
  id: "cli:c1",
  kind: "cli",
  label: "Claude · c1",
  state: "running",
  cpu: 1.2,
  memKb: 4096,
  startedAt: 0,
  procs: [proc()],
  ...over,
});

const props = (over: Partial<Parameters<typeof ServicesDrawer>[0]> = {}) => ({
  services: [svc()],
  loaded: true,
  error: null,
  kill: vi.fn(() => Promise.resolve()),
  restart: vi.fn(() => Promise.resolve()),
  refreshMs: 2000,
  project: null,
  onOpenUrl: vi.fn(),
  notify: vi.fn(),
  ...over,
});

describe("ServicesDrawer", () => {
  it("says it's loading, or why it couldn't", () => {
    const { rerender } = render(<ServicesDrawer {...props({ loaded: false, services: [] })} />);
    expect(screen.getByText("Loading services…")).toBeTruthy();
    rerender(<ServicesDrawer {...props({ loaded: false, services: [], error: "down" })} />);
    expect(screen.getByText("down")).toBeTruthy();
  });

  it("says when there's nothing running for the project", () => {
    const { rerender } = render(<ServicesDrawer {...props({ services: [] })} />);
    expect(screen.getByText(/Nothing running\./)).toBeTruthy();
    rerender(<ServicesDrawer {...props({ services: [], project: "/dev/deckcp" })} />);
    expect(screen.getByText(/Nothing running for this project\./)).toBeTruthy();
  });

  it("renders a CLI row with its usage and an End button", async () => {
    const p = props({ services: [svc({ id: "cli:c1", kind: "cli", label: "Claude", title: "Fix the login page" })] });
    render(<ServicesDrawer {...p} />);
    // The thread's title leads; the CLI moves to the line under it, CPU and memory to their own columns.
    expect(screen.getByText("Fix the login page")).toBeTruthy();
    expect(screen.getByText(/^Claude · \d/)).toBeTruthy();
    expect(screen.getByText("1.2%")).toBeTruthy();
    expect(screen.getByText("4 MB")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "End Fix the login page" }));
    expect(p.kill).toHaveBeenCalledWith({ id: "cli:c1" });
  });

  it("sums the services against this Mac, by kind, and names the busiest", () => {
    const services = [svc({ cpu: 150, memKb: 1024 * 1024, title: "Fix login" }), svc({ id: "weft", kind: "weft", label: "Weft", cpu: 126, memKb: 3 * 1024 * 1024 })];
    render(<ServicesDrawer {...props({ services, machine: { cores: 10, memKb: 16 * 1024 * 1024 } })} />);
    expect(screen.getByText("2.8 of 10 cores · 4.0 GB of 16 GB").getAttribute("title")).toBe("28% of this Mac's CPU, 25% of its memory");
    expect(screen.getByText("Threads")).toBeTruthy();
    expect(screen.getByText("1.5 cores · 1.0 GB")).toBeTruthy();
    expect(screen.getByRole("img", { name: "CPU by kind" })).toBeTruthy();
    expect(screen.getByText("Busiest:")).toBeTruthy();
    expect(screen.getByText("Claude · c1 · Fix login")).toBeTruthy();
    expect(screen.getByText("Most memory:")).toBeTruthy();
  });

  it("renders a weft row with its note and no End button", () => {
    render(<ServicesDrawer {...props({ services: [svc({ id: "weft", kind: "weft", label: "Weft", procs: [proc()], cpu: 0, memKb: 0 })] })} />);
    expect(screen.getByText("Weft")).toBeTruthy();
    expect(screen.getByText(/Weft itself: quit Weft to end it\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /End Weft/ })).toBeNull();
  });

  it("renders a dev row with the url, a Start button for a stopped run and Restart for a running one", async () => {
    const live = props({
      services: [svc({ id: "dev:c1", kind: "dev", label: "pnpm dev", url: "http://localhost:4001", state: "running", cpu: 0, memKb: 0, procs: [proc()] })],
    });
    const { rerender } = render(<ServicesDrawer {...live} />);
    await userEvent.click(screen.getByRole("button", { name: ":4001" }));
    expect(live.onOpenUrl).toHaveBeenCalledWith("http://localhost:4001");
    const restart = screen.getByRole("button", { name: "Restart" });
    await userEvent.click(restart);
    expect(live.restart).toHaveBeenCalledWith("dev:c1");

    // Same row, dead: Start replaces Restart.
    rerender(<ServicesDrawer {...props({
      services: [svc({ id: "dev:c1", kind: "dev", label: "pnpm dev", url: "http://localhost:4001", state: "stopped", cpu: 0, memKb: 0, procs: [proc()] })],
      restart: live.restart,
      onOpenUrl: live.onOpenUrl,
    })} />);
    const start = screen.getByRole("button", { name: "Start" });
    await userEvent.click(start);
    expect(live.restart).toHaveBeenLastCalledWith("dev:c1");
  });

  it("renders a task row with the note about its parent CLI", () => {
    render(<ServicesDrawer {...props({ services: [svc({ id: "task:c1:t1", kind: "task", label: "deckcp dev", state: "stopped", cpu: 0, memKb: 0, procs: [] })] })} />);
    expect(screen.getByText(/Started inside its thread: its CPU and memory count under that thread's CLI\./)).toBeTruthy();
  });

  it("expands Processes and lets you end one of them", async () => {
    const p = props({
      services: [svc({
        id: "cli:c1",
        kind: "cli",
        label: "Claude",
        procs: [proc({ pid: 100, command: "claude" }), proc({ pid: 101, command: "node helper" })],
      })],
    });
    render(<ServicesDrawer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /Processes/ }));
    expect(screen.getByText("node helper")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "End process 101" }));
    expect(p.kill).toHaveBeenCalledWith({ pid: 101 });
  });

  it("changing the refresh select calls setServicesRefreshMs", async () => {
    render(<ServicesDrawer {...props({ refreshMs: 2000 })} />);
    const select = screen.getByLabelText<HTMLSelectElement>("Refresh rate");
    expect(select.value).toBe("2000");
    await userEvent.selectOptions(select, "5000");
    expect(setRefresh).toHaveBeenCalledWith(5000);
  });

  it("filters the list by project (a folder under it counts, others don't)", () => {
    const p = props({
      services: [
        svc({ id: "cli:c1", kind: "cli", label: "this-project", cwd: "/dev/deckcp" }),
        svc({ id: "cli:c2", kind: "cli", label: "nested", cwd: "/dev/deckcp/sub" }),
        svc({ id: "cli:c3", kind: "cli", label: "other", cwd: "/dev/other" }),
        svc({ id: "weft", kind: "weft", label: "Weft", procs: [proc()], cpu: 0, memKb: 0 }),
      ],
      project: "/dev/deckcp",
    });
    render(<ServicesDrawer {...p} />);
    // Its row, and the summary's Busiest line.
    expect(screen.getAllByText("this-project")).toHaveLength(2);
    expect(screen.getByText("nested")).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
    // weft has no cwd, so it shows under every project filter.
    expect(screen.getByText("Weft")).toBeTruthy();
  });

  it("notifies on a failed action and frees the row", async () => {
    const p = props({ kill: vi.fn(() => Promise.reject(new Error("nope"))) });
    render(<ServicesDrawer {...p} />);
    const end = screen.getByRole("button", { name: /End Claude/ });
    await userEvent.click(end);
    await waitFor(() => expect(p.notify).toHaveBeenCalled());
    const err = vi.mocked(p.notify).mock.calls[0]?.[0] as Error;
    expect(err.message).toBe("nope");
    expect((end as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the Dev servers section filtered by project when launch + launchers are passed", () => {
    const p = props({
      launchers: [
        { cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev" }] },
        { cwd: "/dev/deckcp/web", commands: [{ command: "pnpm dev", label: "dev" }] },
        { cwd: "/dev/other", commands: [{ command: "pnpm dev", label: "dev" }] },
      ],
      launch: vi.fn(() => Promise.resolve("started" as const)),
      project: "/dev/deckcp",
    });
    render(<ServicesDrawer {...p} />);
    // The section is named; both folders under the project (and only those) are shown.
    const section = screen.getByRole("region", { name: "Dev servers" });
    expect(section).toBeTruthy();
    expect(screen.getByText("deckcp")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("puts the Dev servers section above the usage summary, and its Stop ends the run", async () => {
    const p = props({
      launchers: [{ cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev", run: { id: "dev:folder:/dev/deckcp", state: "running", startedAt: 0, restarts: 0 } }] }],
      launch: vi.fn(() => Promise.resolve("started" as const)),
    });
    render(<ServicesDrawer {...p} />);
    const section = screen.getByRole("region", { name: "Dev servers" });
    const refresh = screen.getByLabelText("Refresh rate");
    expect(section.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.kill).toHaveBeenCalledWith({ id: "dev:folder:/dev/deckcp" });
  });

  it("opens a thread's card from its name, and leaves names without a card on the board as text", async () => {
    const card = { id: "c1", title: "Build Loom step sequencer" } as Card;
    const onOpenCard = vi.fn();
    const p = props({
      services: [svc({ title: "Build Loom step sequencer" }), svc({ id: "cli:gone", cardId: "gone", title: "Archived thread" })].map((s, i) => (i === 0 ? { ...s, cardId: "c1" } : s)),
      cards: [card],
      onOpenCard,
    });
    render(<ServicesDrawer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Build Loom step sequencer" }));
    expect(onOpenCard).toHaveBeenCalledWith(card);
    expect(screen.queryByRole("button", { name: "Archived thread" })).toBeNull();
    expect(screen.getByText("Archived thread")).toBeTruthy();
  });

  it("opens the card that started a dev server from its 'by' link", async () => {
    const card = { id: "c1", title: "Fix login" } as Card;
    const onOpenCard = vi.fn();
    const p = props({
      launchers: [{ cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev", run: { id: "dev:c1", state: "running", startedAt: 0, restarts: 0, cardId: "c1", title: "Fix login" } }] }],
      launch: vi.fn(() => Promise.resolve("started" as const)),
      cards: [card],
      onOpenCard,
    });
    render(<ServicesDrawer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Fix login" }));
    expect(onOpenCard).toHaveBeenCalledWith(card);
  });

  it("does not render the Dev servers section without a launch prop", () => {
    const p = props({
      launchers: [{ cwd: "/dev/deckcp", commands: [{ command: "pnpm dev", label: "dev" }] }],
    });
    render(<ServicesDrawer {...p} />);
    expect(screen.queryByRole("region", { name: "Dev servers" })).toBeNull();
    expect(screen.queryByText("Dev servers")).toBeNull();
  });

  it("flags a heavy dev server and keeps an idle untracked one", async () => {
    const keep = vi.fn(() => Promise.resolve());
    const heavy = svc({ id: "untracked:9", kind: "other", label: "pnpm dev", untracked: true, stopAt: Date.now() + 60_000, footprintKb: 5 * 1024 * 1024 });
    render(<ServicesDrawer {...props({ services: [heavy], keep })} />);
    expect(screen.getByText("5.0 GB").className).toContain("text-danger");
    await userEvent.click(screen.getByText("Keep"));
    await waitFor(() => expect(keep).toHaveBeenCalledWith("untracked:9"));
  });
});
