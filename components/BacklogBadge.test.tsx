// @vitest-environment jsdom
// The Backlog counter (components/BacklogBadge.tsx): this Mac's from /api/sprint, a worker's from its snapshot, and a
// worker's plan refused with a reason rather than a prompt written for this Mac.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSnapshots } from "@/lib/project-snapshot-view";
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

  it("counts a worker's from its snapshot, and says its plan isn't here yet", async () => {
    const fetch = vi.fn(() => respond({ snapshot: { at: 1, quality: null, scout: null, pile: null, backlog: BACKLOG }, updatedAt: null, worker: "m1mini", status: "online" }));
    vi.stubGlobal("fetch", fetch);
    const onStart = vi.fn();
    const onError = vi.fn();
    render(<BacklogBadge cwd="worker://w1/ling" onStart={onStart} onError={onError} />);
    await userEvent.click(await screen.findByRole("button", { name: "4" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain("isn't here yet");
    expect(onStart).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
