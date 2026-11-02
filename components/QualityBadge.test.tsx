// @vitest-environment jsdom
// The code quality badge's Re-scout: this Mac's runs its own scout, a worker's starts a card there.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSnapshots } from "@/lib/project-snapshot-view";
import QualityBadge from "./QualityBadge";
import "./test-utils";

const Q = { score: 80, sections: [], root: "ling" };
const SCOUT = { report: null, running: false };
const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

beforeEach(() => forgetSnapshots());

describe("QualityBadge Re-scout", () => {
  it("starts a card on the worker for a worker project", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({ snapshot: { at: 1, quality: Q, scout: SCOUT, pile: null, backlog: null }, updatedAt: null, worker: "m1mini", status: "online" })));
    const onImprove = vi.fn();
    render(<QualityBadge cwd="worker://w1/ling" onImprove={onImprove} />);
    await userEvent.click(await screen.findByText("code quality"));
    await userEvent.click(await screen.findByText("Re-scout now"));
    expect(onImprove).toHaveBeenCalledWith("worker://w1/ling", expect.stringContaining("scout-save.mjs"), "Re-scout for refactors");
  });

  it("posts to this Mac's scout for a local project", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) =>
      respond(url.includes("/api/quality") ? { quality: Q } : { scout: SCOUT, seen: init?.method }),
    );
    vi.stubGlobal("fetch", fetch);
    const onImprove = vi.fn();
    render(<QualityBadge cwd="/w/ling" onImprove={onImprove} />);
    await userEvent.click(await screen.findByText("code quality"));
    await userEvent.click(await screen.findByText("Re-scout now"));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    expect(onImprove).not.toHaveBeenCalled();
  });
});
