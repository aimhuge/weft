import { describe, expect, it } from "vitest";
import { CONFIRMATIONS, pickVersion, versionState } from "./site-notes-status";

const VERSION = {
  id: "v1",
  note_id: "n1",
  body: "The API keys live under Settings.",
  author_id: "u1",
  created_at: "2026-10-01T00:00:00Z",
};

const NOTE = { id: "n1", host: "supabase.com", path: "/a", scope: "public" as const, org_id: null };

const report = (user_id: string, outcome: "success" | "failure", updated_at: string, version_id = "v1") => ({
  version_id,
  user_id,
  outcome,
  updated_at,
});

describe("versionState", () => {
  it("counts nothing for a version with no reports", () => {
    expect(versionState(VERSION, [])).toEqual({ confirmations: 0, failures: 0, stale: false, confirmed: false });
  });

  it("ignores reports for other versions", () => {
    const state = versionState(VERSION, [report("u2", "success", "2026-10-02T00:00:00Z", "other")]);
    expect(state.confirmations).toBe(0);
  });

  it("does not count the author's own success", () => {
    const state = versionState(VERSION, [report("u1", "success", "2026-10-02T00:00:00Z")]);
    expect(state.confirmations).toBe(0);
    expect(state.lastSuccess).toBe("2026-10-02");
  });

  it("counts one confirmation per different user", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u2", "success", "2026-10-03T00:00:00Z"),
      report("u3", "success", "2026-10-04T00:00:00Z"),
    ]);
    expect(state.confirmations).toBe(2);
  });

  it("counts a success from a user with a null author id", () => {
    const state = versionState({ ...VERSION, author_id: null }, [report("u2", "success", "2026-10-02T00:00:00Z")]);
    expect(state.confirmations).toBe(1);
  });

  it("confirms once enough different users have succeeded", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
      report("u4", "success", "2026-10-04T00:00:00Z"),
    ]);
    expect(state.confirmations).toBe(CONFIRMATIONS);
    expect(state.confirmed).toBe(true);
  });

  it("is not confirmed with fewer than enough users", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
    ]);
    expect(state.confirmed).toBe(false);
  });

  it("counts failures", () => {
    const state = versionState(VERSION, [report("u2", "failure", "2026-10-02T00:00:00Z")]);
    expect(state.failures).toBe(1);
    expect(state.stale).toBe(true);
  });

  it("is stale when the latest failure is newer than the latest success", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-05T00:00:00Z"),
      report("u3", "failure", "2026-10-06T00:00:00Z"),
    ]);
    expect(state.stale).toBe(true);
    expect(state.lastSuccess).toBe("2026-10-05");
  });

  it("is not stale when the latest success is newer than the latest failure", () => {
    const state = versionState(VERSION, [
      report("u2", "failure", "2026-10-05T00:00:00Z"),
      report("u3", "success", "2026-10-06T00:00:00Z"),
    ]);
    expect(state.stale).toBe(false);
  });

  it("is not stale when the failure and the success share a timestamp", () => {
    const state = versionState(VERSION, [
      report("u2", "failure", "2026-10-05T00:00:00Z"),
      report("u3", "success", "2026-10-05T00:00:00Z"),
    ]);
    expect(state.stale).toBe(false);
  });

  it("is never confirmed once it is stale", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
      report("u4", "success", "2026-10-04T00:00:00Z"),
      report("u5", "failure", "2026-10-05T00:00:00Z"),
    ]);
    expect(state.confirmations).toBe(3);
    expect(state.stale).toBe(true);
    expect(state.confirmed).toBe(false);
  });

  it("keeps the last success as a date", () => {
    const state = versionState(VERSION, [report("u2", "success", "2026-10-02T13:45:00Z")]);
    expect(state.lastSuccess).toBe("2026-10-02");
  });

  it("keeps the newest success even when the reports are out of order", () => {
    const state = versionState(VERSION, [
      report("u2", "success", "2026-10-05T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
    ]);
    expect(state.lastSuccess).toBe("2026-10-05");
  });

  it("keeps the newest failure even when the reports are out of order", () => {
    const state = versionState(VERSION, [
      report("u2", "failure", "2026-10-05T00:00:00Z"),
      report("u3", "failure", "2026-10-03T00:00:00Z"),
    ]);
    expect(state.failures).toBe(2);
    expect(state.stale).toBe(true);
  });
});

describe("pickVersion", () => {
  it("returns null when the note has no versions", () => {
    expect(pickVersion(NOTE, [], [], false)).toBeNull();
  });

  it("ignores versions of other notes", () => {
    expect(pickVersion(NOTE, [{ ...VERSION, note_id: "other" }], [], false)).toBeNull();
  });

  it("serves a team note at once, marked not a candidate", () => {
    const out = pickVersion({ ...NOTE, scope: "team" }, [VERSION], [], false);
    expect(out).toEqual({
      noteId: "n1",
      host: "supabase.com",
      path: "/a",
      scope: "team",
      versionId: "v1",
      body: VERSION.body,
      confirmations: 0,
      stale: false,
      candidate: false,
    });
  });

  it("serves the newest non-stale team version", () => {
    const older = { ...VERSION, id: "v0", created_at: "2026-09-01T00:00:00Z" };
    const newer = { ...VERSION, id: "v1", created_at: "2026-10-01T00:00:00Z" };
    const out = pickVersion({ ...NOTE, scope: "team" }, [older, newer], [report("u2", "failure", "2026-10-02T00:00:00Z", "v1")], false);
    expect(out?.versionId).toBe("v0");
  });

  it("serves the newest team version when every one is stale", () => {
    const older = { ...VERSION, id: "v0", created_at: "2026-09-01T00:00:00Z" };
    const newer = { ...VERSION, id: "v1", created_at: "2026-10-01T00:00:00Z" };
    const out = pickVersion(
      { ...NOTE, scope: "team" },
      [older, newer],
      [report("u2", "failure", "2026-10-02T00:00:00Z", "v0"), report("u3", "failure", "2026-10-02T00:00:00Z", "v1")],
      false,
    );
    expect(out?.versionId).toBe("v1");
    expect(out?.stale).toBe(true);
  });

  it("carries the last success of the version it serves", () => {
    const out = pickVersion({ ...NOTE, scope: "team" }, [VERSION], [report("u2", "success", "2026-10-02T00:00:00Z")], false);
    expect(out?.lastSuccess).toBe("2026-10-02");
  });

  it("serves nothing to a non-contributor while no version is confirmed", () => {
    expect(pickVersion(NOTE, [VERSION], [], false)).toBeNull();
  });

  it("serves a confirmed version to everyone", () => {
    const reports = [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
      report("u4", "success", "2026-10-04T00:00:00Z"),
    ];
    const out = pickVersion(NOTE, [VERSION], reports, false);
    expect(out?.versionId).toBe("v1");
    expect(out?.candidate).toBe(false);
    expect(out?.confirmations).toBe(3);
  });

  it("serves the newest candidate to a contributor", () => {
    const out = pickVersion(NOTE, [VERSION], [], true);
    expect(out?.versionId).toBe("v1");
    expect(out?.candidate).toBe(true);
  });

  it("serves a contributor the newest version even when an older one is confirmed", () => {
    const older = { ...VERSION, id: "v0", created_at: "2026-09-01T00:00:00Z" };
    const newer = { ...VERSION, id: "v1", created_at: "2026-10-01T00:00:00Z" };
    const reports = [
      report("u2", "success", "2026-10-02T00:00:00Z", "v0"),
      report("u3", "success", "2026-10-03T00:00:00Z", "v0"),
      report("u4", "success", "2026-10-04T00:00:00Z", "v0"),
    ];
    const out = pickVersion(NOTE, [older, newer], reports, true);
    expect(out?.versionId).toBe("v1");
    expect(out?.candidate).toBe(true);
  });

  it("does not serve a stale newest version to a contributor", () => {
    const out = pickVersion(NOTE, [VERSION], [report("u2", "failure", "2026-10-02T00:00:00Z")], true);
    expect(out).toBeNull();
  });

  it("serves the confirmed version to a non-contributor when a newer one is unconfirmed", () => {
    const older = { ...VERSION, id: "v0", created_at: "2026-09-01T00:00:00Z" };
    const newer = { ...VERSION, id: "v1", created_at: "2026-10-01T00:00:00Z" };
    const reports = [
      report("u2", "success", "2026-10-02T00:00:00Z", "v0"),
      report("u3", "success", "2026-10-03T00:00:00Z", "v0"),
      report("u4", "success", "2026-10-04T00:00:00Z", "v0"),
    ];
    const out = pickVersion(NOTE, [older, newer], reports, false);
    expect(out?.versionId).toBe("v0");
    expect(out?.candidate).toBe(false);
  });

  it("serves the confirmed version to a contributor when it is the newest one", () => {
    const reports = [
      report("u2", "success", "2026-10-02T00:00:00Z"),
      report("u3", "success", "2026-10-03T00:00:00Z"),
      report("u4", "success", "2026-10-04T00:00:00Z"),
    ];
    const out = pickVersion(NOTE, [VERSION], reports, true);
    expect(out?.versionId).toBe("v1");
    expect(out?.candidate).toBe(false);
  });

  it("picks the newest version by created_at", () => {
    const older = { ...VERSION, id: "v0", created_at: "2026-09-01T00:00:00Z" };
    const newer = { ...VERSION, id: "v1", created_at: "2026-10-01T00:00:00Z" };
    const out = pickVersion(NOTE, [older, newer], [], true);
    expect(out?.versionId).toBe("v1");
  });
});
