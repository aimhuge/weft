// @vitest-environment jsdom
// The header's badges (components/HeaderBadges.tsx): on a worker's project they read its snapshot and show its age,
// while the streak and the sync ask stay on this Mac's folders.
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";

type Props = Record<string, unknown>;
const seen = new Map<string, Props>();
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props): ReactNode {
      seen.set(what, props);
      return null;
    },
}));
vi.mock("@/lib/use-regular-mode", () => ({ useRegularMode: () => false }));

const { default: HeaderBadges } = await import("./HeaderBadges");

function setup(cwd: string | null) {
  seen.clear();
  render(<HeaderBadges cwd={cwd} cards={[]} start={vi.fn()} notify={vi.fn()} toast={vi.fn()} />);
}

describe("HeaderBadges", () => {
  it("reads a worker project's badges, with the snapshot's age, and keeps the streak and the sync ask local", () => {
    setup("worker://w1/ling");
    expect(seen.get("snapshot age")).toMatchObject({ project: "worker://w1/ling" });
    expect(seen.get("quality badge")).toMatchObject({ cwd: "worker://w1/ling" });
    expect(seen.get("pile badge")).toMatchObject({ cwd: "worker://w1/ling" });
    expect(seen.get("streak badge")).toMatchObject({ cwd: null });
    expect(seen.get("sync prompt")).toMatchObject({ cwd: null });
  });

  it("has no age line on this Mac's own project", () => {
    setup("/Users/me/dev/weft");
    expect(seen.has("snapshot age")).toBe(false);
    expect(seen.get("streak badge")).toMatchObject({ cwd: "/Users/me/dev/weft" });
  });
});
