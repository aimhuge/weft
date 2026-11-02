import { describe, expect, it } from "vitest";
import type { WorkerDevGroup } from "./worker-dev-list";
import { shownWorkerDev } from "./worker-dev-view";
import { workerProjectPath } from "./worker-project";

const server = (cardId: string, folder: string) => ({ cardId, folder, command: "pnpm dev", state: "running", startedAt: 1, source: "weft" as const });
const groups: WorkerDevGroup[] = [
  { workerId: "w1", worker: "m1mini", servers: [server("a", "weft"), server("b", "Other")] },
  { workerId: "w2", worker: "vps", servers: [server("c", "weft")] },
  { workerId: "w3", worker: "idle", servers: [] },
];
const ids = (shown: WorkerDevGroup[]) => shown.map((g) => [g.workerId, g.servers.map((s) => s.cardId)]);

describe("shownWorkerDev", () => {
  it("shows every worker with servers for All projects", () => {
    expect(ids(shownWorkerDev(groups, null))).toEqual([["w1", ["a", "b"]], ["w2", ["c"]]]);
  });

  it("shows a Mac project's namesakes on every worker, by folder name", () => {
    expect(ids(shownWorkerDev(groups, "/Users/me/dev/Weft/"))).toEqual([["w1", ["a"]], ["w2", ["c"]]]);
    expect(shownWorkerDev(groups, "/Users/me/dev/nothing")).toEqual([]);
    expect(shownWorkerDev(groups, "/")).toEqual([]);
  });

  it("shows only that worker's checkout for a worker project", () => {
    expect(ids(shownWorkerDev(groups, workerProjectPath("w2", "weft")))).toEqual([["w2", ["c"]]]);
    expect(ids(shownWorkerDev(groups, workerProjectPath("w1", "other")))).toEqual([["w1", ["b"]]]);
  });
});
