// Leases on claimed commands (lib/host/lease.ts): which verbs come back, how often a host renews and reclaims, and a
// database without leases turning them off for a while, said once.
import { describe, expect, it, vi } from "vitest";
import type { CommandLine } from "./identity";
import { IDEMPOTENT_VERBS, RECLAIM_EVERY_MS, RENEW_EVERY_MS, RETRY_OFF_MS, createLeases, missingLeaseSchema, newLeaseState } from "./lease";

function line(over: Partial<CommandLine> = {}): CommandLine {
  return {
    pending: () => Promise.resolve([]),
    claim: () => Promise.resolve(true),
    report: () => Promise.resolve(),
    renew: vi.fn(() => Promise.resolve()),
    reclaim: vi.fn(() => Promise.resolve(0)),
    ...over,
  };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, step: (ms: number) => void (t += ms) };
}

describe("IDEMPOTENT_VERBS", () => {
  it("is the reads, and never a verb that makes a card, starts or stops a turn, or writes", () => {
    expect([...IDEMPOTENT_VERBS].sort()).toEqual(["dev.log", "files.list", "files.read", "files.unwatch", "files.watch", "settings.get", "skills.list"]);
    for (const verb of ["card.create", "card.message", "card.fresh", "card.restart", "card.stop", "card.update", "files.write", "settings.put", "cron.run"]) {
      expect(IDEMPOTENT_VERBS).not.toContain(verb);
    }
  });
});

describe("missingLeaseSchema", () => {
  it("knows PostgREST's words for a missing function or column, and nothing else", () => {
    expect(missingLeaseSchema("worker_renew: Could not find the function public.worker_renew(p_commands, p_key) in the schema cache")).toBe(true);
    expect(missingLeaseSchema("Could not find the 'lease_until' column of 'cloud_commands' in the schema cache")).toBe(true);
    expect(missingLeaseSchema('function public.reclaim_cloud_commands(text, text[]) does not exist')).toBe(true);
    expect(missingLeaseSchema("fetch failed")).toBe(false);
  });
});

describe("createLeases", () => {
  it("renews what it holds, at most once a minute, and nothing when it holds nothing", async () => {
    const c = clock();
    const l = line();
    const leases = createLeases(newLeaseState(), vi.fn(), c.now);
    await leases.renew(l);
    expect(l.renew).not.toHaveBeenCalled();
    leases.hold("a");
    leases.hold("b");
    await leases.renew(l);
    expect(l.renew).toHaveBeenCalledWith(["a", "b"]);
    await leases.renew(l);
    expect(l.renew).toHaveBeenCalledTimes(1);
    c.step(RENEW_EVERY_MS);
    leases.drop("a");
    await leases.renew(l);
    expect(l.renew).toHaveBeenLastCalledWith(["b"]);
  });

  it("reclaims the idempotent verbs at most once a minute, and says when any came back", async () => {
    const c = clock();
    const log = vi.fn();
    const l = line({ reclaim: vi.fn(() => Promise.resolve(2)) });
    const leases = createLeases(newLeaseState(), log, c.now);
    expect(await leases.reclaim(l)).toBe(2);
    expect(l.reclaim).toHaveBeenCalledWith(IDEMPOTENT_VERBS);
    expect(log).toHaveBeenCalledWith("requeued 2 commands whose lease ran out");
    expect(await leases.reclaim(l)).toBe(0);
    c.step(RECLAIM_EVERY_MS);
    vi.mocked(l.reclaim!).mockResolvedValue(1);
    await leases.reclaim(l);
    expect(log).toHaveBeenLastCalledWith("requeued 1 command whose lease ran out");
    c.step(RECLAIM_EVERY_MS);
    vi.mocked(l.reclaim!).mockResolvedValue(0);
    log.mockClear();
    await leases.reclaim(l);
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing on a line without leases", async () => {
    const leases = createLeases(newLeaseState(), vi.fn());
    leases.hold("a");
    const bare = line({ renew: undefined, reclaim: undefined });
    await leases.renew(bare);
    expect(await leases.reclaim(bare)).toBe(0);
  });

  it("turns leases off for an hour on a database without them, said once, and logs any other failure", async () => {
    const c = clock();
    const log = vi.fn();
    const missing = new Error("Could not find the function public.worker_renew in the schema cache");
    const l = line({ renew: vi.fn(() => Promise.reject(missing)), reclaim: vi.fn(() => Promise.reject(missing)) });
    const st = newLeaseState();
    const leases = createLeases(st, log, c.now);
    leases.hold("a");
    expect(await leases.reclaim(l)).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls.at(0)?.[0])).toMatch(/no command leases yet/);
    c.step(RENEW_EVERY_MS);
    await leases.renew(l);
    expect(l.renew).not.toHaveBeenCalled();
    c.step(RETRY_OFF_MS);
    await leases.renew(l);
    expect(l.renew).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    c.step(RETRY_OFF_MS + RENEW_EVERY_MS);
    vi.mocked(l.renew!).mockRejectedValue(new Error("fetch failed"));
    await leases.renew(l);
    expect(log).toHaveBeenLastCalledWith("leases: fetch failed");
  });
});
