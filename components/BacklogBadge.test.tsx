// @vitest-environment jsdom
// The Backlog counter (components/BacklogBadge.tsx): this Mac's from /api/sprint, a worker's from its snapshot, and a
// worker's plan refused with a reason rather than a prompt written for this Mac.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSnapshots } from "@/lib/project-snapshot-view";
import type { Card } from "@/lib/types";
import BacklogBadge from "./BacklogBadge";
import "./test-utils";

const BACKLOG = { root: "/w/ling", count: 4, active: 1 };
const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

beforeEach(() => forgetSnapshots());

describe("BacklogBadge", () => {
  it("counts this Mac's Backlog and starts the plan", async () => {
    const fetch = vi.fn((url: string) => respond(url.includes("prompt=1") ? { prompt: "Plan", title: "Plan it" } : { backlog: BACKLOG }));
    vi.stubGlobal("fetch", fetch);
    const onStart = vi.fn(() => Promise.resolve("c1"));
    render(<BacklogBadge cwd="/w/ling" onStart={onStart} onError={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "4" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith("/w/ling", "Plan", "Plan it"));
  });

  it("counts a worker's from its snapshot, and plans it from the board's cards on the worker", async () => {
    const fetch = vi.fn(() => respond({ snapshot: { at: 1, quality: null, scout: null, pile: null, backlog: BACKLOG }, updatedAt: null, worker: "m1mini", status: "online" }));
    vi.stubGlobal("fetch", fetch);
    const onStart = vi.fn(() => Promise.resolve("c1"));
    const onError = vi.fn();
    const card = { id: "k1", title: "Dark mode", prompt: "add it", column: "backlog", cwd: "worker://w1/ling", createdAt: 1 } as Card;
    render(<BacklogBadge cwd="worker://w1/ling" cards={[card]} onStart={onStart} onError={onError} />);
    await userEvent.click(await screen.findByRole("button", { name: "4" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const [cwd, prompt, title] = onStart.mock.calls[0] as unknown as string[];
    expect(cwd).toBe("worker://w1/ling");
    expect(prompt).toContain('"Dark mode" (card k1');
    expect(title).toBe("Plan the /w/ling backlog into sprints");
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says so when a worker's Backlog is empty", async () => {
    const empty = { root: "ling", count: 0, active: 0 };
    vi.stubGlobal("fetch", vi.fn(() => respond({ snapshot: { at: 1, quality: null, scout: null, pile: null, backlog: empty }, updatedAt: null, worker: "m1mini", status: "online" })));
    const onStart = vi.fn();
    const onError = vi.fn();
    render(<BacklogBadge cwd="worker://w1/ling" onStart={onStart} onError={onError} />);
    await userEvent.click(await screen.findByRole("button", { name: "0" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain("Nothing in Backlog");
    expect(onStart).not.toHaveBeenCalled();
  });
});
