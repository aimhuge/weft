import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "./keychain-audit-view";

// The Keychain audit log's upload to your Weft account (lib/keychain-audit-sync.ts), against a fake client
// and a fake shell: the outbox comes from Electron main, the rows go into keychain_events.

const shellMock = vi.hoisted(() => vi.fn());
vi.mock("./browser-tools", () => ({ shell: shellMock }));

const account = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./account", () => ({ accountClient: account.client }));

const device = vi.hoisted(() => ({ id: vi.fn(() => "dev1") }));
vi.mock("./device-id", () => ({ deviceId: device.id }));

const { rowOf, startKeychainAuditSync, syncKeychainAudit } = await import("./keychain-audit-sync");

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return { id: UUID, seq: 1, at: "2026-10-26T00:00:00.000Z", kind: "vault", action: "fill", outcome: "ok", by: "you", ...over };
}

function fake({ user = "u1", error = null }: { user?: string | null; error?: { message: string } | null } = {}) {
  const upserts: { rows: Record<string, unknown>[]; opts: unknown }[] = [];
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: user ? { user: { id: user } } : null } }) },
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[], opts: unknown) => {
        expect(table).toBe("keychain_events");
        upserts.push({ rows, opts });
        return Promise.resolve({ error });
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, upserts };
}

// The outbox answers with these batches, one per read, then stops. The cursor move isn't a read.
function outbox(...batches: AuditEntry[][]) {
  let i = 0;
  shellMock.mockImplementation((route: string) => {
    if (route !== "/secrets/audit-outbox") return Promise.resolve({});
    const entries = batches[i++] ?? [];
    return Promise.resolve({ entries });
  });
}

// One batch per run: the batch goes up, then the outbox is empty until the next run. Counts the runs.
function outboxPerRun(batch: AuditEntry[]) {
  let served = false;
  shellMock.mockImplementation((route: string) => {
    if (route !== "/secrets/audit-outbox") return Promise.resolve({});
    // An empty read ends the run; the next run starts with the batch again.
    if (served) {
      served = false;
      return Promise.resolve({ entries: [] });
    }
    served = true;
    return Promise.resolve({ entries: batch });
  });
}

beforeEach(() => {
  shellMock.mockReset();
  account.client.mockReset();
  device.id.mockClear();
});

describe("rowOf", () => {
  it("maps a line to its row", () => {
    const row = rowOf(
      entry({
        id: UUID,
        what: "STRIPE_KEY",
        card: "c1",
        thread: "Fix login",
        vault: "aimhuge/weft",
        names: ["STRIPE_KEY"],
        environment: "production",
        site: "dashboard.stripe.com",
        command: "pnpm test",
        detail: "for the deploy",
        via: "touch-id",
        count: 3,
      }),
      "dev1",
      "u1",
    );
    expect(row).toEqual({
      id: UUID,
      user_id: "u1",
      device_id: "dev1",
      seq: 1,
      occurred_at: "2026-10-26T00:00:00.000Z",
      kind: "vault",
      action: "fill",
      outcome: "ok",
      actor: "you",
      what: "STRIPE_KEY",
      card: "c1",
      thread: "Fix login",
      vault: "aimhuge/weft",
      names: ["STRIPE_KEY"],
      environment: "production",
      site: "dashboard.stripe.com",
      command: "pnpm test",
      detail: "for the deploy",
      via: "touch-id",
      repeat_count: 3,
    });
  });

  it("fills what's missing with nulls, an empty list and no count", () => {
    expect(rowOf(entry(), "dev1", "u1")).toEqual({
      id: UUID,
      user_id: "u1",
      device_id: "dev1",
      seq: 1,
      occurred_at: "2026-10-26T00:00:00.000Z",
      kind: "vault",
      action: "fill",
      outcome: "ok",
      actor: "you",
      what: null,
      card: null,
      thread: null,
      vault: null,
      names: [],
      environment: null,
      site: null,
      command: null,
      detail: null,
      via: null,
      repeat_count: 0,
    });
  });
});

describe("syncKeychainAudit", () => {
  it("does nothing signed out", async () => {
    const f = fake({ user: null });
    expect(await syncKeychainAudit(f.client)).toBe(0);
    expect(shellMock).not.toHaveBeenCalled();
    expect(f.upserts).toEqual([]);
  });

  it("uploads the outbox in batches and moves the cursor to the last line", async () => {
    outbox([entry({ id: UUID })], [entry({ id: UUID2, action: "copy" })]);
    const f = fake();
    expect(await syncKeychainAudit(f.client)).toBe(2);
    expect(f.upserts).toHaveLength(2);
    expect(f.upserts[0]?.rows.map((r) => r.id)).toEqual([UUID]);
    expect(f.upserts[0]?.opts).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect(f.upserts[1]?.rows.map((r) => r.id)).toEqual([UUID2]);
    // The cursor moves to the last line of each batch.
    const calls = shellMock.mock.calls;
    expect(calls[0]).toEqual(["/secrets/audit-outbox", {}]);
    expect(calls[1]).toEqual(["/secrets/audit-synced", { id: UUID }]);
    expect(calls[3]).toEqual(["/secrets/audit-synced", { id: UUID2 }]);
    expect(device.id).toHaveBeenCalled();
  });

  it("skips a line without a uuid or a number, but still has main delete it", async () => {
    outbox([entry({ id: "not-a-uuid" }), entry({ id: UUID2, seq: undefined })]);
    const f = fake();
    expect(await syncKeychainAudit(f.client)).toBe(0);
    expect(f.upserts).toEqual([]);
    expect(shellMock.mock.calls[1]).toEqual(["/secrets/audit-synced", { id: UUID2 }]);
  });

  it("stops after five batches", async () => {
    outbox(...Array.from({ length: 10 }, () => [entry({ id: UUID })]));
    const f = fake();
    expect(await syncKeychainAudit(f.client)).toBe(5);
    expect(f.upserts).toHaveLength(5);
    // Five outbox reads, five cursor moves.
    expect(shellMock.mock.calls.filter((c) => c[0] === "/secrets/audit-outbox")).toHaveLength(5);
  });

  it("stops when the outbox is empty", async () => {
    outbox();
    const f = fake();
    expect(await syncKeychainAudit(f.client)).toBe(0);
    expect(shellMock).toHaveBeenCalledTimes(1);
    expect(f.upserts).toEqual([]);
  });

  it("throws when the upload fails", async () => {
    outbox([entry({ id: UUID })]);
    const f = fake({ error: { message: "boom" } });
    await expect(syncKeychainAudit(f.client)).rejects.toThrow("boom");
    // The cursor didn't move: the line goes up next time.
    expect(shellMock.mock.calls.filter((c) => c[0] === "/secrets/audit-synced")).toHaveLength(0);
  });
});

describe("startKeychainAuditSync", () => {
  const global_ = globalThis as { __weftKeychainAudit?: { stop: () => void } };

  // A fake client whose sign-in callback we can fire. Signed in, so the upload actually runs.
  function accountWith(onAuthStateChange: (cb: (event: string) => void) => void) {
    account.client.mockReturnValue({
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
        onAuthStateChange: (cb: (event: string) => void) => {
          onAuthStateChange(cb);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
      from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    delete global_.__weftKeychainAudit;
  });

  it("does nothing without the desktop shell", () => {
    vi.stubEnv("WEFT_SHELL_URL", "");
    const stop = startKeychainAuditSync();
    expect(stop).toBeInstanceOf(Function);
    expect(account.client).not.toHaveBeenCalled();
    expect(shellMock).not.toHaveBeenCalled();
    // Stopping it is a no-op, too.
    stop();
  });

  it("uploads now, again when you sign in, and every minute, until stopped", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
    let fire: ((event: string) => void) | undefined;
    accountWith((cb) => {
      fire = cb;
    });
    outboxPerRun([entry({ id: UUID })]);

    // One run: a batch goes up and the cursor moves.
    const uploads = () => shellMock.mock.calls.filter((c) => c[0] === "/secrets/audit-synced").length;

    const stop = startKeychainAuditSync();
    // The first run happens right away, without waiting for a sign-in.
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toBe(1);

    // Signing in runs it again.
    fire?.("SIGNED_IN");
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toBe(2);

    // Any other event doesn't.
    fire?.("TOKEN_REFRESHED");
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toBe(2);

    // And a minute later.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(uploads()).toBeGreaterThanOrEqual(3);

    stop();
    const after = shellMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(shellMock).toHaveBeenCalledTimes(after);
  });

  it("runs once per server process, and stops the first one", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
    accountWith(() => {});
    outboxPerRun([entry({ id: UUID })]);

    const uploads = () => shellMock.mock.calls.filter((c) => c[0] === "/secrets/audit-synced").length;

    const stop = startKeychainAuditSync();
    expect(global_.__weftKeychainAudit).toBeDefined();
    // The second call hands back the first one's stop, so the timer isn't doubled.
    expect(startKeychainAuditSync()).toBe(stop);
    await vi.advanceTimersByTimeAsync(0);
    const runs = uploads();
    await vi.advanceTimersByTimeAsync(5_000);
    // One timer, one more run: the second call didn't add a second.
    expect(uploads()).toBe(runs + 1);
    stop();
    expect(global_.__weftKeychainAudit).toBeUndefined();
  });

  it("waits quietly when the upload fails", async () => {
    vi.useFakeTimers();
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    accountWith(() => {});
    shellMock.mockRejectedValue(new Error("offline"));

    const stop = startKeychainAuditSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("Keychain audit upload: offline");
    stop();
    warn.mockRestore();
  });

  it("does nothing when accounts aren't set up in this build", () => {
    vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
    account.client.mockImplementation(() => {
      throw new Error("Weft accounts aren't set up in this build yet.");
    });
    const stop = startKeychainAuditSync();
    expect(stop).toBeInstanceOf(Function);
    expect(shellMock).not.toHaveBeenCalled();
    // Stopping it is a no-op, too.
    stop();
  });
});
