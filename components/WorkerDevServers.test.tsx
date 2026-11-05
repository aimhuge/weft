// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerDevGroup } from "@/lib/worker-dev-list";
import WorkerDevServers from "./WorkerDevServers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const server = (over: Partial<WorkerDevGroup["servers"][number]> = {}): WorkerDevGroup["servers"][number] => ({
  cardId: "c1",
  folder: "weft",
  command: "pnpm dev",
  url: "http://localhost:3000",
  state: "running",
  startedAt: 1,
  source: "weft",
  ...over,
});
const groups = (servers = [server()]): WorkerDevGroup[] => [{ workerId: "w1", worker: "m1mini", servers }];
const setup = (over: Partial<Parameters<typeof WorkerDevServers>[0]> = {}) => {
  const props = { groups: groups(), project: null, onOpenUrl: vi.fn(), notify: vi.fn(), open: vi.fn<(id: string) => Promise<string>>(() => Promise.resolve("https://weft.zip/t/new")), stop: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()), restart: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()), readLog: vi.fn<(id: string) => Promise<string>>(() => Promise.resolve("ready on :3000")), ...over };
  render(<WorkerDevServers {...props} />);
  return props;
};

describe("WorkerDevServers", () => {
  it("shows nothing with no worker servers, or none in the picked project", () => {
    setup({ groups: [] });
    expect(screen.queryByLabelText("Worker dev servers")).toBeNull();
    cleanup();
    setup({ project: "/Users/me/dev/other" });
    expect(screen.queryByLabelText("Worker dev servers")).toBeNull();
  });

  it("opens a server's open address at once", async () => {
    const p = setup({ groups: groups([server({ address: "https://weft.zip/t/t1" })]), project: "/Users/me/dev/Weft/" });
    expect(screen.getByText("On m1mini")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(p.onOpenUrl).toHaveBeenCalledWith("https://weft.zip/t/t1"));
    expect(p.open).not.toHaveBeenCalled();
  });

  it("asks the worker for an address when it has none, and says why it couldn't", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(p.onOpenUrl).toHaveBeenCalledWith("https://weft.zip/t/new"));
    expect(p.open).toHaveBeenCalledWith("c1");
    vi.mocked(p.open).mockRejectedValueOnce(new Error("no Mac"));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith(new Error("no Mac")));
  });

  it("stops a Weft run, and offers neither button where they mean nothing", async () => {
    const p = setup({ groups: groups([server(), server({ cardId: "c2", url: undefined, source: "thread", state: "weird" }), server({ cardId: "c3", state: "stopped" })]) });
    const stops = screen.getAllByRole("button", { name: "Stop" });
    expect(stops).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
    await userEvent.click(stops[0]!);
    await waitFor(() => expect(p.stop).toHaveBeenCalledWith("c1"));
  });

  it("restarts a Weft run, or starts one that ended", async () => {
    const p = setup({ groups: groups([server(), server({ cardId: "c2", state: "failed" })]) });
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(p.restart).toHaveBeenCalledWith("c1"));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(p.restart).toHaveBeenCalledWith("c2"));
  });

  it("reads a run's log into its row, and hides it on a second click", async () => {
    const p = setup({ groups: groups([server(), server({ cardId: "c2", source: "thread" })]) });
    expect(screen.getAllByRole("button", { name: "Log" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(await screen.findByText("ready on :3000")).toBeTruthy();
    expect(p.readLog).toHaveBeenCalledWith("c1");
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.queryByText("ready on :3000")).toBeNull();
    vi.mocked(p.readLog).mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith(new Error("offline")));
  });

  it("shows a worker project's own servers only", () => {
    setup({ groups: [...groups(), { workerId: "w2", worker: "vps", servers: [server({ cardId: "c9" })] }], project: "worker://w2/weft" });
    expect(screen.queryByText("On m1mini")).toBeNull();
    expect(screen.getByText("On vps")).toBeTruthy();
  });

  it("shows the whole command in its tooltip", () => {
    setup({ groups: groups([server()]) });
    expect(screen.getByTitle("pnpm dev")).toBeTruthy();
  });
});
