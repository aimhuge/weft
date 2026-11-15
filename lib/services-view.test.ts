import { describe, expect, it } from "vitest";
import {
  STATE_TONE,
  filterServices,
  formatCpu,
  formatMem,
  idleNote,
  liveCount,
  serviceRow,
  servicesTitle,
} from "./services-view";
import type { ServiceEntry } from "./types";

const entry = (over: Partial<ServiceEntry> = {}): ServiceEntry => ({
  id: "weft",
  kind: "weft",
  label: "Weft",
  state: "running",
  cpu: 0,
  memKb: 0,
  startedAt: 0,
  procs: [],
  ...over,
});

describe("filterServices", () => {
  it("returns everything when no project is picked", () => {
    const list = [entry({ cwd: "/a" }), entry({ id: "b", cwd: "/b" })];
    expect(filterServices(list, null)).toEqual(list);
  });

  it("keeps services with no cwd (Weft, terminals, others)", () => {
    const weft = entry({ id: "weft" });
    const list = [weft, entry({ id: "b", cwd: "/proj" }), entry({ id: "c", cwd: "/other" })];
    expect(filterServices(list, "/proj").map((s) => s.id)).toEqual(["weft", "b"]);
  });

  it("treats a folder inside the project as part of the project", () => {
    const list = [entry({ cwd: "/proj" }), entry({ id: "b", cwd: "/proj/web" }), entry({ id: "c", cwd: "/proj-old" })];
    expect(filterServices(list, "/proj").map((s) => s.cwd)).toEqual(["/proj", "/proj/web"]);
  });
});

describe("liveCount", () => {
  it("counts running and starting, and never counts Weft itself", () => {
    expect(liveCount([entry(), entry({ id: "b", kind: "cli", state: "running" }), entry({ id: "c", kind: "cli", state: "starting" }), entry({ id: "d", kind: "cli", state: "stopped" }), entry({ id: "e", kind: "cli", state: "failed" })])).toBe(2);
  });
});

describe("servicesTitle", () => {
  it("uses the right copy", () => {
    expect(servicesTitle(0)).toBe("Services: nothing running");
    expect(servicesTitle(3)).toBe("Services: 3 running");
  });
});

describe("formatCpu", () => {
  it("uses one decimal under ten, rounds above", () => {
    expect(formatCpu(0)).toBe("0.0%");
    expect(formatCpu(1.23)).toBe("1.2%");
    expect(formatCpu(9.95)).toBe("9.9%");
    expect(formatCpu(10)).toBe("10%");
    expect(formatCpu(150.6)).toBe("151%");
  });
});

describe("formatMem", () => {
  it("formats KB, MB and GB", () => {
    expect(formatMem(0)).toBe("0 KB");
    expect(formatMem(500)).toBe("500 KB");
    expect(formatMem(1024)).toBe("1 MB");
    expect(formatMem(5 * 1024)).toBe("5 MB");
    expect(formatMem(1024 * 1024)).toBe("1.0 GB");
    expect(formatMem(2.5 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("serviceRow", () => {
  const now = 100_000;
  it("renders a live CLI row with where it runs, for how long, and is killable", () => {
    const e = entry({ id: "cli:c1", kind: "cli", label: "Claude Code", cardId: "c1", cwd: "/repo", title: "Fix it", state: "running", startedAt: now - 17 * 60_000, cpu: 1.2, memKb: 1024 * 100, procs: [{ pid: 100, ppid: 1, cpu: 1.2, memKb: 1024 * 100, command: "node" }] });
    const row = serviceRow(e, now);
    expect(row).toEqual({
      key: "cli:c1",
      label: "Claude Code",
      name: "Fix it",
      meta: "Claude Code · repo · 17m",
      state: "running",
      live: true,
      cpu: "1.2%",
      mem: "100 MB",
      memTitle: "Resident memory (RSS)",
      canKill: true,
      canRestart: false,
    });
  });

  it("hides the duration for a stopped service", () => {
    const e = entry({ id: "b", kind: "dev", label: "vite", cwd: "/repo", state: "stopped", startedAt: now - 60_000, cpu: 0, memKb: 0, procs: [{ pid: 1, ppid: 1, cpu: 0, memKb: 0, command: "vite" }] });
    const row = serviceRow(e, now);
    expect(row.name).toBe("vite");
    expect(row.meta).toBe("repo");
    expect(row.live).toBe(false);
    expect(row.canKill).toBe(false);
    expect(row.canRestart).toBe(true);
  });

  it("flags a thread's task with its note", () => {
    const e = entry({ id: "task:c1:t1", kind: "task", label: "vite", cardId: "c1", cwd: "/repo", taskId: "t1", state: "running", startedAt: now, procs: [] });
    const row = serviceRow(e, now);
    expect(row.canKill).toBe(true);
    expect(row.canRestart).toBe(false);
    expect(row.note).toMatch(/that thread's CLI/);
  });

  it("flags Weft itself with its note", () => {
    const e = entry({ state: "running", startedAt: now, procs: [{ pid: 1, ppid: 1, cpu: 0, memKb: 0, command: "next-server" }] });
    const row = serviceRow(e, now);
    expect(row.canKill).toBe(false);
    expect(row.canRestart).toBe(false);
    expect(row.note).toMatch(/quit Weft/);
  });

  it("leaves the process count to the row's toggle", () => {
    const e = entry({ id: "b", kind: "dev", label: "vite", cwd: "/repo", state: "running", startedAt: now, cpu: 1, memKb: 0, procs: [
      { pid: 1, ppid: 1, cpu: 0.5, memKb: 0, command: "vite" },
      { pid: 2, ppid: 1, cpu: 0.5, memKb: 0, command: "vite worker" },
    ] });
    const row = serviceRow(e, now);
    expect(row.meta).toBe("repo · 0s");
  });

  it("includes the url when present", () => {
    const e = entry({ id: "b", kind: "dev", label: "vite", cwd: "/repo", url: "http://localhost:4001", state: "running", startedAt: now, cpu: 1, memKb: 0, procs: [{ pid: 1, ppid: 1, cpu: 1, memKb: 0, command: "vite" }] });
    expect(serviceRow(e, now).url).toBe("http://localhost:4001");
  });
});

describe("STATE_TONE", () => {
  it("has a tone for every service state", () => {
    expect(STATE_TONE.running).toBe("bg-ok");
    expect(STATE_TONE.starting).toBe("bg-accent");
    expect(STATE_TONE.stopped).toBe("bg-faint");
    expect(STATE_TONE.failed).toBe("bg-danger");
  });
});

describe("idle and footprint", () => {
  const dev = (over: Partial<ServiceEntry> = {}) => entry({ id: "dev:c1", kind: "dev", label: "pnpm dev", procs: [{ pid: 1, ppid: 0, cpu: 0, memKb: 1024, command: "node" }], memKb: 1024, ...over });

  it("says how long a server has been idle, when it stops, or that it was stopped", () => {
    const now = 60 * 60_000;
    expect(idleNote(dev({ activeAt: now - 4 * 60_000 }), now)).toBeUndefined();
    expect(idleNote(dev({ activeAt: now - 12 * 60_000 }), now)).toMatch(/^idle /);
    expect(idleNote(dev({ stopAt: now + 61_500 }), now)).toBe("idle · stops in 62s");
    expect(idleNote(dev({ stopAt: now - 5 }), now)).toBe("idle · stops in 0s");
    expect(idleNote(dev({ idleStopped: true }), now)).toBe("stopped after 30 idle min");
    expect(idleNote(dev(), now)).toBeUndefined();
  });

  it("shows the real footprint, flags one over 3 GB, and offers Keep on a pending stop", () => {
    const heavy = serviceRow(dev({ footprintKb: 5 * 1024 * 1024 }), 0);
    expect(heavy).toMatchObject({ mem: "5.0 GB", heavy: true, memTitle: "Real memory: RAM + compressed + swapped, over 3 GB" });
    const light = serviceRow(dev(), 0);
    expect(light).toMatchObject({ mem: "1 MB", memTitle: "Resident memory (RSS)" });
    expect(light.heavy).toBeUndefined();
    expect(light.canKeep).toBeUndefined();
    const untracked = serviceRow(dev({ id: "untracked:9", kind: "other", untracked: true, stopAt: 5, cwd: "/x/app" }), 0);
    expect(untracked.canKeep).toBe(true);
    expect(untracked.meta).toMatch(/^untracked · app · /);
  });
});
