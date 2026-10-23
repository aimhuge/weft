// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlastcpBridge, BlastcpFolder, BlastcpPost, BlastcpStatus } from "@/lib/blastcp-view";
import "./test-utils";
import BlastcpDrawer from "./BlastcpDrawer";

const connectWeft = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client", () => ({ api: { connectBlastcpWithWeft: connectWeft } }));

const H = 3_600_000;
const URL_ = "https://blastcp.com/alex/property/weft";

const post = (over: Partial<BlastcpPost>): BlastcpPost => ({ id: "p", platform: "linkedin", status: "draft", title: "Hi", scheduledFor: null, publishedAt: null, url: null, reviewUrl: null, ...over });
const folder = (path: string, over: Partial<BlastcpFolder> = {}): BlastcpFolder => ({ folder: path, link: null, posts: null, error: null, ...over });
const signedIn = (folders: BlastcpFolder[], over: Partial<BlastcpStatus> = {}): BlastcpStatus => ({ signedIn: true, user: { email: "me@x.com" }, expiresAt: null, error: null, folders, ...over });

const LINK = { org: "alex", property: "weft", name: "Weft", url: URL_ };

function bridge(): { [K in keyof BlastcpBridge]: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(),
    connect: vi.fn(() => Promise.resolve({ email: "me@x.com" })),
    forget: vi.fn(() => Promise.resolve({ signedIn: false })),
    workspaces: vi.fn(() =>
      Promise.resolve([
        { slug: "alex", name: "Alex", properties: [{ slug: "blog", name: "Blog" }, { slug: "weft", name: "Weft" }] },
        { slug: "side", name: "Side", properties: [{ slug: "pod", name: "Podcast" }] },
      ]),
    ),
    link: vi.fn(() => Promise.resolve({ linked: true, name: "Weft" })),
    createProperty: vi.fn(() => Promise.resolve({ linked: true, name: "Weft Blog" })),
    unlink: vi.fn(() => Promise.resolve({ linked: false })),
  };
}

function setup(status: BlastcpStatus | null, { project = null, error = null, b = bridge() }: { project?: string | null; error?: string | null; b?: ReturnType<typeof bridge> } = {}) {
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  render(<BlastcpDrawer bridge={b as unknown as BlastcpBridge} status={status} error={error} reload={reload} project={project} onOpenUrl={onOpenUrl} notify={notify} />);
  return { b, reload, notify, onOpenUrl };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BlastcpDrawer", () => {
  it("explains itself outside the desktop app, on an error, and while loading", () => {
    const { unmount } = render(<BlastcpDrawer bridge={null} status={null} error={null} reload={vi.fn()} project={null} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    unmount();
    setup(null, { error: "offline" });
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("asks for a restart when main hasn't loaded BlastCP yet", async () => {
    const splashAction = vi.fn();
    window.weft = { splashAction } as unknown as typeof window.weft;
    setup(null, { error: "Error invoking remote method 'blastcp:status': Error: No handler registered for 'blastcp:status'" });
    expect(screen.getByText("Restart Weft to turn on BlastCP")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Restart Weft"));
    expect(splashAction).toHaveBeenCalledWith("relaunch");
    expect(screen.getByText("Restarting…")).toBeDisabled();
    expect(screen.getByText(/open it again/)).toBeInTheDocument();
    delete window.weft;
  });

  it("shows Asking while the first status loads", () => {
    setup(null);
    expect(screen.getByText("Asking BlastCP…")).toBeInTheDocument();
  });

  it("connects through the browser when signed out", async () => {
    const { b, notify, reload } = setup({ signedIn: false, user: null, expiresAt: null, error: null, folders: [] });
    expect(screen.queryByText("Forget it")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Another BlastCP account"));
    expect(b.connect).toHaveBeenCalled();
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Connected to BlastCP as me@x.com"));
    expect(reload).toHaveBeenCalled();
  });

  it("connects with the Weft account and says when it made the BlastCP account", async () => {
    connectWeft.mockResolvedValueOnce({ state: "connected", email: "me@x.com", created: true }).mockResolvedValueOnce({ state: "connected" });
    const { notify, reload } = setup({ signedIn: false, user: null, expiresAt: null, error: null, folders: [] });
    await userEvent.click(screen.getByText("Connect with Weft"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Made your BlastCP account and connected it"));
    expect(reload).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Connect with Weft"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Connected to BlastCP with your Weft account"));
  });

  it("explains a Weft connect that didn't connect, and opens BlastCP's confirm page", async () => {
    connectWeft.mockResolvedValueOnce({ state: "signed-out" });
    const { notify, onOpenUrl } = setup({ signedIn: false, user: null, expiresAt: null, error: null, folders: [], linkUrl: "https://blastcp.com/link/weft?ticket=t" });
    await userEvent.click(screen.getByText("Connect with Weft"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Sign in to your Weft account/)));
    await userEvent.click(screen.getByText("Confirm it's you on BlastCP"));
    expect(onOpenUrl).toHaveBeenCalledWith("https://blastcp.com/link/weft?ticket=t");
  });

  it("renews a sign-in Weft made through Weft, not the browser", async () => {
    connectWeft.mockResolvedValueOnce({ state: "connected" });
    const { b } = setup(signedIn([], { viaWeft: true, expiresAt: Date.now() + 2 * 24 * H }));
    await userEvent.click(screen.getByText("Reconnect"));
    await waitFor(() => expect(connectWeft).toHaveBeenCalled());
    expect(b.connect).not.toHaveBeenCalled();
  });

  it("offers to forget a sign-in BlastCP turned down, and reports a failed connect", async () => {
    const b = bridge();
    b.connect.mockRejectedValueOnce(new Error("You turned BlastCP down in the browser."));
    const { notify } = setup(signedIn([], { error: "BlastCP's sign-in ran out. Connect again." }), { b });
    expect(screen.getByText(/sign-in ran out/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Another BlastCP account"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "You turned BlastCP down in the browser." })));
    await userEvent.click(screen.getByText("Forget it"));
    expect(b.forget).toHaveBeenCalled();
  });

  it("shows a linked property's queue, counts and last post, and opens posts in the pane", async () => {
    const now = Date.now();
    const posts = [
      ...[1, 2, 3, 4, 5].map((n) => post({ id: `s${n}`, status: "scheduled", scheduledFor: now + n * H, title: n === 1 ? "First up" : `Post ${n}`, reviewUrl: `${URL_}/posts/s${n}` })),
      post({ id: "nolink", status: "scheduled", scheduledFor: now + 9 * H, title: null }),
      post({ id: "d" }),
      post({ id: "f", status: "failed" }),
      post({ id: "out", status: "published", publishedAt: now - 2 * H, platform: "threads" }),
    ];
    const { onOpenUrl } = setup(signedIn([folder("/dev/weft", { link: LINK, posts })]));
    expect(screen.getByText("me@x.com")).toBeInTheDocument();
    expect(screen.getByText("First up")).toBeInTheDocument();
    expect(screen.getByText("+2 more scheduled")).toBeInTheDocument();
    expect(screen.getByText(/Last out .*: Threads/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("First up"));
    expect(onOpenUrl).toHaveBeenLastCalledWith(`${URL_}/posts/s1`);
    await userEvent.click(screen.getByText("1 draft · 1 failed"));
    expect(onOpenUrl).toHaveBeenLastCalledWith(`${URL_}/drafts`);
    await userEvent.click(screen.getByTitle("Open its queue in the browser pane"));
    expect(onOpenUrl).toHaveBeenLastCalledWith(`${URL_}/queue`);
  });

  it("shows empty, loading and broken properties, and unlinks", async () => {
    const { b } = setup(
      signedIn([
        folder("/a", { link: LINK, posts: [post({ status: "awaiting_human" }), post({ id: "u", status: "scheduled", scheduledFor: Date.now() + H, title: null })] }),
        folder("/b", { link: { ...LINK, name: "Blog" }, posts: [] }),
        folder("/c", { link: { ...LINK, name: "Pod" } }),
        folder("/d", { link: { ...LINK, name: "Gone" }, error: "No property" }),
      ]),
    );
    expect(screen.getByText("1 to approve")).toHaveClass("text-warn");
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
    expect(screen.getByText("Loading posts…")).toBeInTheDocument();
    expect(screen.getByText("No property")).toBeInTheDocument();
    await userEvent.click(screen.getAllByText("Unlink")[0]!);
    expect(b.unlink).toHaveBeenCalledWith("/a");
  });

  it("warns before the sign-in runs out and reconnects", async () => {
    const { b } = setup(signedIn([], { expiresAt: Date.now() + 2 * 86_400_000 }));
    expect(screen.getByText("Add a project to the board to link it to a BlastCP property.")).toBeInTheDocument();
    expect(screen.getByText(/runs out in 2 days/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Reconnect"));
    expect(b.connect).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Sign out"));
    expect(b.forget).toHaveBeenCalled();
  });

  it("links a folder to a property, best fit first, across workspaces", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/weft"), folder("/dev/other")]), { project: "/dev/weft" });
    expect(screen.queryByText("other")).not.toBeInTheDocument();
    expect(screen.getByText("Not linked to a BlastCP property")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Link…"));
    await screen.findByText("best fit");
    const names = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toContain("Weft");
    expect(names[0]).toContain("weft · Alex");
    await userEvent.type(screen.getByLabelText("Search BlastCP properties"), "zzz");
    expect(screen.getByText("No property matches.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search BlastCP properties"));
    await userEvent.click(screen.getByText("Weft"));
    expect(b.link).toHaveBeenCalledWith("/dev/weft", "alex", "weft", "Weft");
    await waitFor(() => expect(notify).toHaveBeenCalledWith("weft now posts as Weft on BlastCP"));
    // The workspaces are kept for the next pick.
    await userEvent.click(screen.getByText("Link…"));
    expect(b.workspaces).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("Search BlastCP properties")).not.toBeInTheDocument();
  });

  it("makes a new property from the search, in the workspace you pick, and links it", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/weft")]));
    await userEvent.click(screen.getByText("Link…"));
    await userEvent.type(await screen.findByLabelText("Search BlastCP properties"), "Weft Blog");
    await userEvent.click(screen.getByText("+ New property “Weft Blog”"));
    expect(screen.getByLabelText("New property name")).toHaveValue("Weft Blog");
    await userEvent.selectOptions(screen.getByLabelText("Workspace"), "side");
    await userEvent.click(screen.getByText("Create & link"));
    expect(b.createProperty).toHaveBeenCalledWith("/dev/weft", "side", "Weft Blog");
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Made Weft Blog on BlastCP; weft now posts as it"));
    // The next pick asks BlastCP again, so the new property is in the list.
    await userEvent.click(screen.getByText("Link…"));
    await waitFor(() => expect(b.workspaces).toHaveBeenCalledTimes(2));
  });

  it("names a new property after the folder, needs a name, and Back or Escape leaves the form", async () => {
    const b = bridge();
    b.workspaces.mockResolvedValueOnce([{ slug: "alex", name: "Alex", properties: [] }]);
    setup(signedIn([folder("/dev/my-app")]), { b });
    await userEvent.click(screen.getByText("Link…"));
    expect(await screen.findByText("No properties yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("+ New property…"));
    const name = screen.getByLabelText("New property name");
    expect(name).toHaveValue("My App");
    // One workspace: no choice to make.
    expect(screen.queryByLabelText("Workspace")).not.toBeInTheDocument();
    await userEvent.clear(name);
    expect(screen.getByText("Create & link")).toBeDisabled();
    await userEvent.type(name, "{Enter}");
    expect(b.createProperty).not.toHaveBeenCalled();
    await userEvent.type(name, "{Escape}");
    await userEvent.click(screen.getByText("+ New property…"));
    await userEvent.click(screen.getByText("Back"));
    await userEvent.click(screen.getByText("+ New property…"));
    await userEvent.type(screen.getByLabelText("New property name"), "{Enter}");
    expect(b.createProperty).toHaveBeenCalledWith("/dev/my-app", "alex", "My App");
  });

  it("keeps the form open when BlastCP refuses the name", async () => {
    const b = bridge();
    b.createProperty.mockRejectedValueOnce(new Error('Workspace "alex" already has a property with the slug "weft".'));
    const { notify } = setup(signedIn([folder("/dev/weft")]), { b });
    await userEvent.click(screen.getByText("Link…"));
    await userEvent.click(await screen.findByText("+ New property…"));
    await userEvent.click(screen.getByText("Create & link"));
    await waitFor(() => expect(String(notify.mock.calls[0]?.[0])).toContain("already has"));
    expect(screen.getByLabelText("New property name")).toHaveValue("Weft");
  });

  it("points to BlastCP when there's no workspace, and cancels", async () => {
    const b = bridge();
    const { onOpenUrl } = setup(signedIn([folder("/dev/weft")]), { b });
    let answer: (v: unknown) => void = () => {};
    b.workspaces.mockReturnValueOnce(new Promise((ok) => (answer = ok)));
    await userEvent.click(screen.getByText("Link…"));
    expect(screen.getByText("Loading your BlastCP properties…")).toBeInTheDocument();
    answer([]);
    await userEvent.click(await screen.findByText("Make one on BlastCP"));
    expect(screen.queryByText(/New property/)).not.toBeInTheDocument();
    expect(onOpenUrl).toHaveBeenCalledWith("https://blastcp.com");
    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Link…")).toBeInTheDocument();
  });

  it("closes the picker when the properties don't load", async () => {
    const b = bridge();
    b.workspaces.mockRejectedValueOnce(new Error("down"));
    const { notify } = setup(signedIn([folder("/dev/weft")]), { b });
    await userEvent.click(screen.getByText("Link…"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "down" })));
    expect(screen.getByText("Link…")).toBeInTheDocument();
  });
});
