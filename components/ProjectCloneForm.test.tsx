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

function Harness({ onPicked, onError }: { onPicked: (path: string | null) => void; onError: (m: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    try {
      onPicked(await action());
    } finally {
      setBusy(false);
    }
  }
  return <ProjectCloneForm value={value} onChange={setValue} busy={busy} onError={onError} run={run} />;
}

beforeEach(() => vi.clearAllMocks());

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
});
