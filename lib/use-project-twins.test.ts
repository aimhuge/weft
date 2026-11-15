// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCard } from "../components/test-utils";
import { NO_REVIEW_FILTER } from "./board-view";
import { useProjectTwins } from "./use-project-twins";
import type { Project } from "./types";
import { workerProjectPath, type WorkerProject } from "./worker-project";

const wpath = workerProjectPath("w1", "Weft");
const wp: WorkerProject = { path: wpath, workerId: "w1", worker: "m1mini", folder: "Weft", status: "online" };
const only: WorkerProject = { path: workerProjectPath("w1", "solo"), workerId: "w1", worker: "m1mini", folder: "solo", status: "online" };
const saved = { path: "/dev/weft", lastUsedAt: 1 } as Project;
const view = { query: "", sort: "newest" as const, showArchived: false, reviewFilter: NO_REVIEW_FILTER };
const cards = [
  makeCard({ id: "a", cwd: "/dev/weft", column: "running" }),
  makeCard({ id: "b", cwd: wpath, column: "needs_you" }),
  makeCard({ id: "c", cwd: only.path, column: "done" }),
  makeCard({ id: "d", cwd: wpath, column: "done", archived: true }),
];
const run = (selected: string | null) =>
  renderHook(() => useProjectTwins({ selected, projects: [saved], cards, workerProjects: [wp, only], rootOf: (c) => c, railFilter: {}, view })).result.current;

describe("useProjectTwins", () => {
  it("makes one chip for a repo on this Mac and a worker, with the counts added and the worker in twins", () => {
    const r = run(null);
    expect(r.summaries.map((s) => s.path).sort()).toEqual(["/dev/weft", only.path].sort());
    expect(r.summaries.find((s) => s.path === "/dev/weft")).toMatchObject({ cards: 3, running: 1, needsYou: 1, twins: [{ name: "m1mini", status: "online" }] });
    expect(r.summaries.find((s) => s.path === only.path)).toMatchObject({ worker: { name: "m1mini" } });
  });

  it("selects a worker card under the local project, and maps a saved worker:// selection to it", () => {
    for (const selected of ["/dev/weft", wpath]) {
      const r = run(selected);
      expect(r.project).toBe("/dev/weft");
      expect(r.byColumn.get("needs_you")?.map((c) => c.id)).toEqual(["b"]);
      expect(r.byColumn.get("running")?.map((c) => c.id)).toEqual(["a"]);
      expect(r.byColumn.get("done")).toEqual([]);
      expect(r.archivedCount).toBe(1);
    }
    expect(run(only.path).project).toBe(only.path);
    expect(run(null).archivedCount).toBe(1);
    expect(run(null).projectOf(wpath)).toBe("/dev/weft");
  });
});
