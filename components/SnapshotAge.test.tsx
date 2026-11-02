// @vitest-environment jsdom
// The age of a worker project's snapshot before its badges (components/SnapshotAge.tsx): nothing while it's fresh,
// "12m ago, m1mini offline" when it isn't.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSnapshots } from "@/lib/project-snapshot-view";
import SnapshotAge from "./SnapshotAge";
import "./test-utils";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
vi.mock("@/lib/use-now", () => ({ useNow: () => NOW }));

const view = (updatedAt: string | null, status = "online") => ({ snapshot: null, updatedAt, worker: "m1mini", status });

beforeEach(() => forgetSnapshots());

describe("SnapshotAge", () => {
  it("says how old a stale snapshot is and that the worker is offline", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(view("2026-11-02T11:48:00.000Z", "offline"))))));
    render(<SnapshotAge project="worker://w1/ling" />);
    expect(await screen.findByText("12m ago, m1mini offline")).toBeInTheDocument();
  });

  it("says nothing while it's fresh", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(view("2026-11-02T11:59:00.000Z")))));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<SnapshotAge project="worker://w1/ling" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
