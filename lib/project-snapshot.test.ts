// A worker's snapshot of one folder (lib/project-snapshot.ts): every header read at once, a failing one as null, the
// scout's cached report only (never a new run), and a report too big for the row left out.
import { beforeEach, describe, expect, it, vi } from "vitest";

const quality = vi.hoisted(() => ({ measureQuality: vi.fn(), projectRoot: vi.fn((cwd: string) => cwd) }));
vi.mock("./quality", () => quality);
const scout = vi.hoisted(() => ({ readScout: vi.fn() }));
vi.mock("./scout", () => scout);
const summaries = vi.hoisted(() => ({ pileOf: vi.fn(), backlogOf: vi.fn() }));
vi.mock("./project-summaries", () => summaries);

const { SNAPSHOT_MAX, readProjectSnapshot } = await import("./project-snapshot");

beforeEach(() => {
  vi.clearAllMocks();
  quality.measureQuality.mockReturnValue({ root: "/w/ling", score: 70, sections: [], coverageAt: null });
  scout.readScout.mockReturnValue({ root: "/w/ling", findings: [], started: [], commit: null, ranAt: 1 });
  summaries.pileOf.mockReturnValue({ summary: { root: "/w/ling", files: 2, added: 5, removed: 1, cards: 0 } });
  summaries.backlogOf.mockReturnValue(null);
});

describe("readProjectSnapshot", () => {
  it("reads quality, the scout's last report, the pile and the Backlog, stamped, with no absolute worker path", () => {
    summaries.backlogOf.mockReturnValueOnce({ summary: { root: "/w/ling", count: 2, active: 0 } });
    const snap = readProjectSnapshot("/w/ling", [], 42);
    expect(snap).toEqual({
      at: 42,
      quality: { root: "ling", score: 70, sections: [], coverageAt: null },
      scout: { report: { root: "ling", findings: [], started: [], commit: null, ranAt: 1 }, running: false },
      pile: { root: "ling", files: 2, added: 5, removed: 1, cards: 0 },
      backlog: { root: "ling", count: 2, active: 0 },
    });
    expect(JSON.stringify(snap)).not.toContain("/w/");
  });

  it("makes a read that fails, or a scout that never ran, a null badge", () => {
    quality.measureQuality.mockImplementationOnce(() => {
      throw new Error("no package.json");
    });
    scout.readScout.mockReturnValueOnce(null);
    summaries.pileOf.mockReturnValueOnce(null);
    const snap = readProjectSnapshot("/w/ling", []);
    expect(snap.quality).toBeNull();
    expect(snap.scout).toBeNull();
    expect(snap.pile).toBeNull();
    expect(typeof snap.at).toBe("number");
  });

  it("leaves the scout out when the snapshot would be too big for its row", () => {
    scout.readScout.mockReturnValueOnce({ root: "/w/ling", findings: [{ fix: "x".repeat(SNAPSHOT_MAX) }], started: [], commit: null, ranAt: 1 });
    const snap = readProjectSnapshot("/w/ling", []);
    expect(snap.scout).toBeNull();
    expect(snap.quality).not.toBeNull();
  });
});
