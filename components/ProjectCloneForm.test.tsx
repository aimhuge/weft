// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { CloneJob } from "@/lib/clone-progress";
import ProjectCloneForm from "./ProjectCloneForm";

const finish = vi.hoisted(() => ({ clone: vi.fn<(path: string) => void>() }));
const api = vi.hoisted(() => ({
  cloneRepo: vi.fn(
    () =>
      new Promise<{ path: string; projects: [] }>((resolve) => {
        finish.clone.mockImplementation((path) => resolve({ path, projects: [] }));
      }),
  ),
  cloneProgress: vi.fn<(fullName: string) => Promise<CloneJob | null>>(() =>
    Promise.resolve({ status: "running", line: "Receiving objects · 1.2 MiB | 2.3 MiB/s", percent: 42 }),
  ),
}));
vi.mock("@/lib/client", () => ({ api }));
const workers = vi.hoisted(() => ({
  view: { signedIn: true, workers: [] as unknown[] },
  clone: vi.fn<(id: string, repo: string) => Promise<{ status: string; error: string | null }>>(),
}));
vi.mock("@/lib/use-workers", () => ({ useWorkers: () => workers }));

const worker = (over = {}) => ({ id: "w-1", name: "m1mini", mine: true, kind: "headless", status: "online", ...over });

function Harness({ onPicked, onError, onNotice }: { onPicked: (path: string | null) => void; onError: (m: string) => void; onNotice?: (m: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    try {
      onPicked(await action());
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <ProjectCloneForm value={value} onChange={setValue} busy={busy} onError={onError} onNotice={onNotice} run={run} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  workers.view = { signedIn: true, workers: [] };
});

describe("ProjectCloneForm", () => {
  it("clones a pasted GitHub URL with a progress bar, then picks the folder", async () => {
    const onPicked = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPicked={onPicked} onError={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "https://github.com/aimhuge/weft.git{Enter}");

    expect(api.cloneRepo).toHaveBeenCalledWith("aimhuge/weft");
    expect(screen.getByRole("button", { name: "Cloning…" })).toBeDisabled();
    const bar = await screen.findByRole("progressbar", { name: "Cloning aimhuge/weft" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "42"));
    expect(bar).toHaveTextContent("Receiving objects · 1.2 MiB | 2.3 MiB/s");
    expect(api.cloneProgress).toHaveBeenCalledWith("aimhuge/weft");

    act(() => finish.clone("/home/dev/weft"));
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith("/home/dev/weft"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows Starting… until the first answer, and ignores a finished job", async () => {
    api.cloneProgress.mockResolvedValue({ status: "done", line: "Cloned", percent: 100 });
    const user = userEvent.setup();
    render(<Harness onPicked={vi.fn()} onError={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "me/app{Enter}");
    const bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(api.cloneProgress).toHaveBeenCalled());
    expect(bar).toHaveTextContent("Starting…");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    act(() => finish.clone("/home/dev/app"));
  });

  it("refuses something that isn't owner/name", async () => {
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPicked={vi.fn()} onError={onError} />);
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "not a repo{Enter}");
    expect(onError).toHaveBeenCalledWith("Use owner/name, like aimhuge/weft.");
    expect(api.cloneRepo).not.toHaveBeenCalled();
  });

  it("adds no control with no headless worker of yours", () => {
    workers.view = { signedIn: true, workers: [worker({ kind: "desktop" }), worker({ mine: false })] };
    render(<Harness onPicked={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Clone to" })).not.toBeInTheDocument();
  });

  it("defaults to This Mac, and marks an offline worker", async () => {
    workers.view = { signedIn: true, workers: [worker({ status: "offline" })] };
    const onPicked = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPicked={onPicked} onError={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Clone to" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "m1mini (offline)" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "me/app{Enter}");
    expect(api.cloneRepo).toHaveBeenCalledWith("me/app");
    expect(workers.clone).not.toHaveBeenCalled();
    act(() => finish.clone("/home/dev/app"));
    await waitFor(() => expect(onPicked).toHaveBeenCalled());
  });

  it("clones on a worker with no prompt, and says where it went", async () => {
    workers.view = { signedIn: true, workers: [worker()] };
    workers.clone.mockResolvedValue({ status: "done", error: null });
    const onPicked = vi.fn();
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPicked={onPicked} onError={vi.fn()} onNotice={onNotice} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Clone to" }), "w-1");
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "https://github.com/aimhuge/weft{Enter}");
    expect(workers.clone).toHaveBeenCalledWith("w-1", "aimhuge/weft");
    expect(api.cloneRepo).not.toHaveBeenCalled();
    const said = "Cloned aimhuge/weft onto m1mini, in the folder weft.";
    expect(await screen.findByText(said)).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith(said);
    expect(onPicked).toHaveBeenCalledWith(null);
  });

  it("shows the worker's real failure in the menu and in the toast", async () => {
    workers.view = { signedIn: true, workers: [worker()] };
    workers.clone.mockRejectedValue(new Error("This worker isn't signed in to GitHub."));
    const onError = vi.fn();
    const onNotice = vi.fn();
    const user = userEvent.setup();
    render(<Harness onPicked={vi.fn()} onError={onError} onNotice={onNotice} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Clone to" }), "w-1");
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "me/app{Enter}");
    await waitFor(() => expect(onError).toHaveBeenCalledWith("This worker isn't signed in to GitHub."));
    expect(onNotice).toHaveBeenCalledWith("This worker isn't signed in to GitHub.");
  });

  it("says when a worker hasn't picked the clone up", async () => {
    workers.view = { signedIn: true, workers: [worker()] };
    workers.clone.mockResolvedValue({ status: "pending", error: null });
    const user = userEvent.setup();
    render(<Harness onPicked={vi.fn()} onError={vi.fn()} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Clone to" }), "w-1");
    await user.type(screen.getByRole("textbox", { name: "GitHub repo" }), "me/app{Enter}");
    expect(await screen.findByText(/hasn't picked up me\/app yet/)).toBeInTheDocument();
  });
});
