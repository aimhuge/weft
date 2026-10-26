// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import { makeCard } from "./test-utils";
import type { MenuItem } from "@/lib/card-menu";

const api = vi.hoisted(() => ({
  markProject: vi.fn(() => Promise.resolve({ projects: [] })),
  repos: vi.fn(() => Promise.resolve({ repos: [{ path: "/p", github: "me/p" }] })),
}));
vi.mock("@/lib/client", () => ({ api }));
const stopNow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow }));
const openChangelog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/changelog-open", () => ({ openChangelog }));

const event = (preventDefault = vi.fn()) => ({ preventDefault, stopPropagation: vi.fn() }) as unknown as React.MouseEvent;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(pick: string | null, over: Partial<ProjectMenuDeps> = {}, shellOver: Record<string, unknown> = {}) {
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  const shell = {
    popupMenu,
    revealFolder: vi.fn(),
    openExternal: vi.fn(),
    openIn: vi.fn(() => Promise.resolve("Cursor")),
    ...shellOver,
  };
  (window as unknown as { weft: unknown }).weft = shell;
  const deps = {
    projects: [{ path: "/p", lastActivity: 0, cards: 3, running: 1, needsYou: 0, pinned: true }],
    cards: [
      makeCard({ id: "d1", cwd: "/p", column: "done" }),
      makeCard({ id: "d2", cwd: "/p/.wt", column: "done", archived: true }),
      makeCard({ id: "r1", cwd: "/p/.wt", column: "running" }),
      makeCard({ id: "x", cwd: "/other", column: "done" }),
    ],
    rootOf: (cwd: string) => (cwd.startsWith("/p") ? "/p" : cwd),
    openNew: vi.fn(),
    chooseProject: vi.fn(),
    openDrawer: vi.fn(),
    archive: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    ...over,
  } satisfies ProjectMenuDeps;
  const onMenu = projectMenuHandler(deps);
  return { deps, shell, popupMenu, run: async () => { const picked = await onMenu("/p", event()); await flush(); return picked; } };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("projectMenuHandler", () => {
  it("leaves the browser's own menu alone without a shell", async () => {
    const onMenu = projectMenuHandler({} as ProjectMenuDeps);
    const preventDefault = vi.fn();
    expect(await onMenu("/p", event(preventDefault))).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("builds the menu from the project's marks and its own unarchived cards", async () => {
    const { popupMenu, run } = setup(null);
    expect(await run()).toBe(false);
    const items = popupMenu.mock.calls[0]![0];
    const byId = (id: string) => items.find((i) => "id" in i && i.id === id);
    expect(byId("unpin")).toBeTruthy();
    expect(byId("archive-done")).toMatchObject({ label: "Archive 1 Card in Done" });
    expect(byId("stop-running")).toMatchObject({ label: "Stop 1 Running Card" });
    expect(byId("editor")).toBeTruthy();
  });

  it("starts a thread, reveals, copies and opens the changelog for the project", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    let t = setup("new");
    await t.run();
    expect(t.deps.openNew).toHaveBeenCalledWith("/p");
    t = setup("reveal");
    await t.run();
    expect(t.shell.revealFolder).toHaveBeenCalledWith("/p");
    t = setup("copy-path");
    await t.run();
    expect(writeText).toHaveBeenCalledWith("/p");
    t = setup("changelog");
    expect(await t.run()).toBe(true);
    expect(openChangelog).toHaveBeenCalledWith("/p");
  });

  it("opens the folder in an editor or terminal, and says when there's none", async () => {
    let t = setup("editor");
    await t.run();
    expect(t.shell.openIn).toHaveBeenCalledWith("/p", "editor");
    expect(t.deps.toast).toHaveBeenCalledWith("Opened p in Cursor.");
    t = setup("terminal", {}, { openIn: vi.fn(() => Promise.resolve(null)) });
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("No terminal app found in Applications.");
    t = setup("editor", {}, { openIn: vi.fn(() => Promise.resolve(null)) });
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("No code editor found in Applications.");
  });

  it("opens the repo on GitHub, or says it has no remote", async () => {
    let t = setup("github");
    await t.run();
    expect(t.shell.openExternal).toHaveBeenCalledWith("https://github.com/me/p");
    api.repos.mockResolvedValueOnce({ repos: [] });
    t = setup("github");
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("p has no GitHub remote.");
  });

  it("opens the secrets and dev server drawers on the project", async () => {
    let t = setup("secrets");
    await t.run();
    expect(t.deps.chooseProject).toHaveBeenCalledWith("/p");
    expect(t.deps.openDrawer).toHaveBeenCalledWith("vault");
    t = setup("services");
    await t.run();
    expect(t.deps.openDrawer).toHaveBeenCalledWith("services");
  });

  it("pins, unpins, hides and shows the project", async () => {
    for (const [pick, marks] of [["pin", { pinned: true }], ["unpin", { pinned: false }], ["hide", { hidden: true }], ["show", { hidden: false }]] as const) {
      await setup(pick).run();
      expect(api.markProject).toHaveBeenLastCalledWith("/p", marks);
    }
  });

  it("archives its Done cards and stops its running ones", async () => {
    let t = setup("archive-done");
    await t.run();
    expect(t.deps.archive).toHaveBeenCalledWith([expect.objectContaining({ id: "d1" })]);
    t = setup("stop-running");
    await t.run();
    expect(stopNow).toHaveBeenCalledWith("r1");
    expect(t.deps.toast).toHaveBeenCalledWith("Stopped 1 card in p.");
  });

  it("reports a failed action", async () => {
    api.markProject.mockRejectedValueOnce(new Error("nope"));
    const t = setup("pin");
    await t.run();
    expect(t.deps.notify).toHaveBeenCalledWith(new Error("nope"));
  });
});
