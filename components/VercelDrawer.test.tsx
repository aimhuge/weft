// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VercelBridge, VercelFolder, VercelStatus } from "@/lib/vercel-view";
import "./test-utils";
import VercelDrawer from "./VercelDrawer";

const folder = (path: string, over: Partial<VercelFolder> = {}): VercelFolder => ({ folder: path, repo: null, link: null, error: null, ...over });

const signedIn = (folders: VercelFolder[]): VercelStatus => ({ signedIn: true, user: { username: "fotoflo" }, error: null, folders });

const LINKED = folder("/dev/web", {
  repo: "me/web",
  link: {
    projectId: "prj_1",
    orgId: "team_a",
    name: "web",
    team: "Acme",
    git: "me/other",
    url: "https://web.example.com",
    dashboard: "https://vercel.com/acme/web",
    latest: { state: "ERROR", url: "https://web-abc.vercel.app", createdAt: Date.now() - 60_000, target: "preview", page: "https://vercel.com/acme/web/dpl1" },
  },
});

function bridge(): { [K in keyof VercelBridge]: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(),
    setToken: vi.fn(() => Promise.resolve({ username: "fotoflo" })),
    forgetToken: vi.fn(() => Promise.resolve({ signedIn: false })),
    projects: vi.fn(() =>
      Promise.resolve([
        { id: "p1", name: "old-thing", orgId: "team_a", team: "Acme", teamSlug: "acme", git: null, framework: null, updatedAt: 9 },
        { id: "p2", name: "notes", orgId: "u_1", team: "Personal", teamSlug: null, git: "me/notes", framework: null, updatedAt: 1 },
      ]),
    ),
    scopes: vi.fn(() => Promise.resolve({ scopes: [{ id: null, name: "Personal" }, { id: "team_a", name: "Acme" }], defaultId: "team_a" })),
    link: vi.fn(() => Promise.resolve({ linked: true, name: "notes" })),
    create: vi.fn(() => Promise.resolve({ created: true, name: "my-site", git: "me/site", gitError: null })),
    unlink: vi.fn(() => Promise.resolve({ linked: false })),
  };
}

function setup(status: VercelStatus | null, project: string | null = null, error: string | null = null, tweak: (b: Record<string, unknown>) => void = () => {}) {
  const b = bridge();
  tweak(b);
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  const openExternal = vi.fn();
  (window as unknown as { weft: unknown }).weft = { openExternal };
  render(<VercelDrawer bridge={b as unknown as VercelBridge} status={status} error={error} reload={reload} project={project} onOpenUrl={onOpenUrl} notify={notify} />);
  return { b, reload, notify, onOpenUrl, openExternal };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("VercelDrawer", () => {
  it("explains itself outside the desktop app, while loading, and on an error", () => {
    const { rerender } = render(<VercelDrawer bridge={null} status={null} error={null} reload={vi.fn()} project={null} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    const b = bridge() as unknown as VercelBridge;
    rerender(<VercelDrawer bridge={b} status={null} error={null} reload={vi.fn()} project={null} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("Asking Vercel…")).toBeInTheDocument();
    rerender(<VercelDrawer bridge={b} status={null} error="offline" reload={vi.fn()} project={null} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("offers a vault's token by name and keeps it after Touch ID, or says nothing changed", async () => {
    const pick = { folder: "/dev/web", name: "VERCEL_TOKEN", environment: "development" as const };
    const { b, reload, notify } = setup({ signedIn: false, user: null, error: null, folders: [folder("/dev/web")] }, null, null, (x) => {
      x.vaultTokenCandidates = vi.fn(() => Promise.resolve([{ ...pick, label: "aimhuge/weft" }]));
      x.useVaultToken = vi.fn().mockResolvedValueOnce({ denied: true }).mockResolvedValueOnce({ missing: true }).mockResolvedValueOnce({ status: { username: "fotoflo" } });
    });
    const offer = await screen.findByRole("button", { name: /Use VERCEL_TOKEN from aimhuge\/weft/ });
    await userEvent.click(offer);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Touch ID said no, so nothing changed."));
    await userEvent.click(offer);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("That vault no longer has the value."));
    await userEvent.click(offer);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Vercel as fotoflo"));
    expect(b.useVaultToken).toHaveBeenCalledWith(expect.objectContaining(pick));
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("asks for a token, opens the token page, and saves it", async () => {
    const { b, reload, notify, openExternal } = setup({ signedIn: false, user: null, error: null, folders: [] });
    expect(screen.queryByRole("button", { name: "Forget it" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "vercel.com/account/tokens" }));
    expect(openExternal).toHaveBeenCalledWith("https://vercel.com/account/tokens");
    const save = screen.getByRole("button", { name: "Save token" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Vercel token"), "tok");
    await userEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Vercel as fotoflo"));
    expect(b.setToken).toHaveBeenCalledWith("tok");
    expect(reload).toHaveBeenCalled();
    expect(screen.getByLabelText("Vercel token")).toHaveValue("");
  });

  it("shows a token that stopped working, lets you forget it, and toasts a failed save", async () => {
    const { b, notify } = setup({ signedIn: true, user: null, error: "Vercel turned the token down. Add a new one.", folders: [] });
    expect(screen.getByText(/turned the token down/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Forget it" }));
    expect(b.forgetToken).toHaveBeenCalled();
    b.setToken.mockRejectedValueOnce(new Error("nope"));
    await userEvent.type(screen.getByLabelText("Vercel token"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("nope")));
  });

  it("shows a linked project: its deploy, url, GitHub mismatch and dashboard", async () => {
    const { b, onOpenUrl, openExternal } = setup(signedIn([LINKED, folder("/dev/notes")]), "/dev/web");
    expect(screen.getByText("Signed in as fotoflo")).toBeInTheDocument();
    expect(screen.queryByText("notes")).not.toBeInTheDocument();
    expect(screen.getByText("▲ web")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/^preview · /)).toBeInTheDocument();
    expect(screen.getByText("Deploys from me/other, not me/web")).toHaveClass("text-warn");
    await userEvent.click(screen.getByRole("button", { name: "web.example.com" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://web.example.com");
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://web-abc.vercel.app");
    await userEvent.click(screen.getByRole("button", { name: "Dashboard ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://vercel.com/acme/web");
    await userEvent.click(screen.getByRole("button", { name: "Deploy ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://vercel.com/acme/web/dpl1");
    await userEvent.click(screen.getByRole("button", { name: "Env ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://vercel.com/acme/web/settings/environment-variables");
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(b.unlink).toHaveBeenCalledWith("/dev/web");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(b.forgetToken).toHaveBeenCalled();
  });

  it("shows a production deploy, no deploys yet, and a link Vercel can't read", () => {
    const prod = folder("/dev/a", { link: { projectId: "p", orgId: "o", name: "a", git: "me/a", latest: { state: "READY", url: null, createdAt: 0, target: "production" } } });
    const none = folder("/dev/b", { link: { projectId: "q", orgId: "o", name: "b", latest: null } });
    const broken = folder("/dev/c", { link: { projectId: "gone", orgId: "o", name: null }, error: "Vercel answered 404." });
    setup(signedIn([prod, none, broken]));
    expect(screen.getByText(/^production · /)).toBeInTheDocument();
    expect(screen.getByText("Deploys from me/a")).not.toHaveClass("text-warn");
    expect(screen.getByText("No deploys yet")).toBeInTheDocument();
    expect(screen.getByText("gone: Vercel answered 404.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unlink" })).toHaveLength(3);
  });

  it("links a folder from the picker, best fit first, and searches", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/notes", { repo: "me/notes" }), folder("/dev/plain")]));
    expect(screen.getByText("me/notes · not on Vercel yet")).toBeInTheDocument();
    expect(screen.getByText("Not linked to a Vercel project")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[0]!);
    const picker = await screen.findByRole("region", { name: "Link notes" });
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByText(/^(notes|old-thing)$/).map((e) => e.textContent)).toEqual(["notes", "old-thing"]));
    expect(screen.getByText("best fit")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search Vercel projects"), "zzz");
    expect(screen.getByText("No project matches.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search Vercel projects"));
    await userEvent.click(screen.getByRole("button", { name: /^notes/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Linked notes to notes on Vercel"));
    expect(b.link).toHaveBeenCalledWith("/dev/notes", "p2", "u_1");
    expect(picker).not.toBeInTheDocument();
    // The list is loaded once per drawer.
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(b.projects).toHaveBeenCalledTimes(1);
  });

  it("says when the token reaches no projects", async () => {
    const { b } = setup(signedIn([folder("/dev/x")]));
    b.projects.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    expect(await screen.findByText("No projects on Vercel yet: make one above.")).toBeInTheDocument();
  });

  it("makes a new project from the picker: repo name, default team, GitHub on", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/site", { repo: "me/my-site" })]));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await userEvent.click(screen.getByRole("button", { name: /New project/ }));
    const form = screen.getByRole("form", { name: "New Vercel project" });
    expect(screen.getByRole("heading", { name: "New Vercel project" })).toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("my-site");
    expect(await screen.findByLabelText("Team")).toHaveValue("team_a");
    expect(screen.getByRole("checkbox")).toBeChecked();
    await userEvent.clear(name);
    await userEvent.type(name, "a---b");
    expect(screen.getByText(/no '---'/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create and link" })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, "My-Site");
    expect(name).toHaveValue("my-site");
    await userEvent.selectOptions(screen.getByLabelText("Team"), "Personal");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create and link" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Made my-site on Vercel and linked site; pushes to me/site deploy it"));
    expect(b.create).toHaveBeenCalledWith("/dev/site", { name: "my-site", teamId: null, git: false });
    expect(form).not.toBeInTheDocument();
    // The list loads again next time, with the new project in it.
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await waitFor(() => expect(b.projects).toHaveBeenCalledTimes(2));
  });

  it("goes back to the list, says when there's no GitHub remote, and toasts a failed team list", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/plain")]));
    b.scopes.mockRejectedValueOnce(new Error("teams down"));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await userEvent.click(screen.getByRole("button", { name: /New project/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("teams down")));
    expect(screen.getByText("Loading your teams…")).toBeInTheDocument();
    expect(screen.getByText(/No GitHub remote/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Search Vercel projects")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /New project/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Search Vercel projects")).toBeInTheDocument();
  });

  it("closes the picker and toasts when the project list fails", async () => {
    const first = setup(signedIn([folder("/dev/x")]));
    first.b.projects.mockRejectedValueOnce(new Error("down"));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await waitFor(() => expect(first.notify).toHaveBeenCalledWith(new Error("down")));
    expect(screen.getByRole("button", { name: "Link…" })).toBeInTheDocument();
  });

  it("asks for a project when the board has none", () => {
    setup(signedIn([]));
    expect(screen.getByText("Add a project to the board to link it to Vercel.")).toBeInTheDocument();
  });
});
