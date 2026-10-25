import { beforeEach, describe, expect, it, vi } from "vitest";

// Deploys for Slack: each look asks main for the board folders' latest deployment and posts one when it ends
// READY, ERROR or CANCELED. What was already there on the first look is never posted.

const main = vi.hoisted(() => ({ shell: vi.fn<(route: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>>() }));
vi.mock("./browser-tools", () => main);

const deploys = await import("./slack-deploys");

interface Deploy {
  state: string;
  createdAt: number;
  target?: string;
  url?: string | null;
  page?: string | null;
}

interface Folder {
  folder: string;
  link?: { projectId: string; name?: string | null; latest?: Deploy | null } | null;
}

// One folder with a deployment in a given state.
const folder = (state: string, createdAt: number, over: Partial<Folder> = {}): Folder => ({
  folder: "/dev/app",
  link: { projectId: "prj_1", name: "app", latest: { state, createdAt, target: "production" } },
  ...over,
});

const status = (folders: Folder[]) => ({ folders });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDeployWatch", () => {
  it("asks main for nothing when there are no folders", async () => {
    const watch = deploys.createDeployWatch(vi.fn());
    await watch.tick([]);
    expect(main.shell).not.toHaveBeenCalled();
  });

  it("has no deploy to post when main answers with no folders", async () => {
    main.shell.mockResolvedValue({});
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    expect(main.shell).toHaveBeenCalledWith("/vercel/status", { folders: ["/dev/app"] });
    expect(post).not.toHaveBeenCalled();
  });

  it("skips a folder with no link, or a link with no deploy", async () => {
    main.shell.mockResolvedValue(status([{ folder: "/dev/app", link: null }, folder("READY", 1, { link: { projectId: "prj_2", latest: null } })]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("never posts a deploy that was already there on the first look", async () => {
    main.shell.mockResolvedValue(status([folder("READY", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("posts a deploy once it ends, and only once", async () => {
    main.shell.mockResolvedValue(status([folder("BUILDING", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    expect(post).not.toHaveBeenCalled();

    // The same deploy, now finished: it was still building on the first look, so its end is posted.
    main.shell.mockResolvedValue(status([folder("READY", 1)]));
    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(1);

    main.shell.mockResolvedValue(status([folder("READY", 2)]));
    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(2);
    const text = JSON.stringify(post.mock.calls[0]?.[0]);
    expect(text).toContain("🚀");
    expect(text).toContain("app");
    expect(text).toContain("production");

    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("never posts a deploy that had already ended on the first look", async () => {
    main.shell.mockResolvedValue(status([folder("READY", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    await watch.tick(["/dev/app"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("posts a failed deploy with its build logs", async () => {
    main.shell.mockResolvedValue(status([folder("BUILDING", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    main.shell.mockResolvedValue(status([{ folder: "/dev/app", link: { projectId: "prj_1", name: "app", latest: { state: "ERROR", createdAt: 2, page: "https://x.dev/logs" } } }]));
    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(post.mock.calls[0]?.[0])).toContain("build logs");
  });

  it("posts a deploy that was cancelled", async () => {
    main.shell.mockResolvedValue(status([folder("BUILDING", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    main.shell.mockResolvedValue(status([folder("CANCELED", 2)]));
    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("posts a new deploy that comes after the one it already saw", async () => {
    main.shell.mockResolvedValue(status([folder("READY", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    main.shell.mockResolvedValue(status([folder("READY", 2)]));
    await watch.tick(["/dev/app"]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("names the project by its id when the link has no name", async () => {
    main.shell.mockResolvedValue(status([folder("BUILDING", 1)]));
    const post = vi.fn();
    const watch = deploys.createDeployWatch(post);
    await watch.tick(["/dev/app"]);
    main.shell.mockResolvedValue(status([{ folder: "/dev/app", link: { projectId: "prj_1", name: null, latest: { state: "READY", createdAt: 2 } } }]));
    await watch.tick(["/dev/app"]);
    expect(JSON.stringify(post.mock.calls[0]?.[0])).toContain("prj_1");
  });
});
