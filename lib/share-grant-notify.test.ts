import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/share-grant-notify.ts against a fake service client: every table answers from `db`, the count query and the
// notified_at update resolve when awaited, and the slug path comes from a mocked lib/share-access.

vi.mock("server-only", () => ({}));
const shareSlugPath = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<string | null>>(() => Promise.resolve(null)));
vi.mock("./share-access", () => ({ shareSlugPath }));

const { DAILY_CAP, githubPublicEmail, notifyGrant, resendSender } = await import("./share-grant-notify");
type SendEmail = import("./share-grant-notify").SendEmail;
type PublicEmail = import("./share-grant-notify").PublicEmail;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const SHARE = "abcdefghijklmnop";

interface Db {
  grant: { github_login: string; notified_at: string | null } | null;
  share: { id: string; org_id: string; card_id: string; slug: string | null; created_by: string } | null;
  card: { card: { title?: unknown; emoji?: unknown } | null } | null;
  count: number | null;
  contact: unknown;
  user: unknown;
  userThrows: boolean;
  updates: { row: Record<string, unknown>; filters: Record<string, unknown> }[];
  grantFilters: Record<string, unknown>[];
}
let db: Db;

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  let op: "select" | "update" = "select";
  let row: Record<string, unknown> = {};
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: unknown) => {
      filters[col] = v;
      return q;
    },
    gte: (col: string, v: unknown) => {
      filters[`${col}>=`] = v;
      return q;
    },
    update: (r: Record<string, unknown>) => {
      op = "update";
      row = r;
      return q;
    },
    maybeSingle: () => {
      if (table === "cloud_share_grants") {
        db.grantFilters.push(filters);
        return Promise.resolve({ data: db.grant });
      }
      if (table === "cloud_shares") return Promise.resolve({ data: db.share });
      return Promise.resolve({ data: db.card });
    },
    then: (done: (r: unknown) => unknown) => {
      if (op === "update") {
        db.updates.push({ row, filters });
        return Promise.resolve({ error: null }).then(done);
      }
      return Promise.resolve({ count: db.count }).then(done);
    },
  };
  return q;
}

const rpc = vi.fn<(name: string, args: unknown) => Promise<{ data: unknown }>>(() => Promise.resolve({ data: db.contact }));
const service = {
  from: (t: string) => chain(t),
  rpc,
  auth: {
    admin: {
      getUserById: () => (db.userThrows ? Promise.reject(new Error("down")) : Promise.resolve({ data: { user: db.user } })),
    },
  },
} as unknown as SupabaseClient;

const send = vi.fn<SendEmail>(() => Promise.resolve());
const publicEmail = vi.fn<PublicEmail>(() => Promise.resolve(null));
const NOW = new Date("2026-11-09T12:00:00.000Z");
const deps = (over: Partial<Parameters<typeof notifyGrant>[0]> = {}) => ({ service, send, publicEmail, origin: "https://weft.zip", now: () => NOW, ...over });

beforeEach(() => {
  db = {
    grant: { github_login: "octo", notified_at: null },
    share: { id: SHARE, org_id: "o1", card_id: "c1", slug: null, created_by: "u1" },
    card: { card: { title: "  Fix the login bug  ", emoji: "🐛" } },
    count: 0,
    contact: "octo@weft.zip",
    user: { user_metadata: { full_name: "Ada", user_name: "ada" } },
    userThrows: false,
    updates: [],
    grantFilters: [],
  };
  vi.clearAllMocks();
  shareSlugPath.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyGrant", () => {
  it("refuses a bad share id or a bad githubId", async () => {
    const bad = { status: 400, json: { error: "Send { githubId, note? }." } };
    expect(await notifyGrant(deps(), "u1", "nope", { githubId: 1 })).toEqual(bad);
    expect(await notifyGrant(deps(), "u1", SHARE, null)).toEqual(bad);
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: "1" })).toEqual(bad);
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 1.5 })).toEqual(bad);
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 0 })).toEqual(bad);
  });

  it("is a 404 for a grant this user didn't add", async () => {
    db.grant = null;
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).toEqual({ status: 404, json: { error: "No such grant." } });
    expect(db.grantFilters[0]).toEqual({ share_id: SHARE, github_id: 7, granted_by: "u1" });
  });

  it("answers emailed for a grant already told, sending nothing", async () => {
    db.grant = { github_login: "octo", notified_at: "2026-11-08T00:00:00.000Z" };
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).toEqual({ status: 200, json: { notice: "emailed" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the weft.zip account's address and stamps notified_at", async () => {
    const out = await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
    expect(out).toEqual({ status: 200, json: { notice: "emailed" } });
    expect(rpc).toHaveBeenCalledWith("share_grant_contact", { github: 7 });
    expect(publicEmail).not.toHaveBeenCalled();
    const [to, subject, text, html] = send.mock.calls[0]!;
    expect(to).toBe("octo@weft.zip");
    expect(subject).toBe("Ada shared a thread with you: Fix the login bug");
    expect(text).toContain(`https://weft.zip/s/${SHARE}`);
    expect(text).toContain("🐛 Fix the login bug");
    expect(text).toContain("Ada (@ada)");
    expect(html).toContain("<!doctype html>");
    expect(db.updates).toEqual([{ row: { notified_at: NOW.toISOString() }, filters: { share_id: SHARE, github_id: 7 } }]);
  });

  it("uses the slug path and quotes a clipped note", async () => {
    shareSlugPath.mockResolvedValue("/@ada/threads/login");
    await notifyGrant(deps(), "u1", SHARE, { githubId: 7, note: "  can you   look?  " });
    const [, subject, text] = send.mock.calls[0]!;
    expect(subject).toBe('Ada mentioned you in "Fix the login bug"');
    expect(text).toContain('"can you look?"');
    expect(text).toContain("https://weft.zip/@ada/threads/login");
  });

  it("falls back to the GitHub public email", async () => {
    db.contact = null;
    publicEmail.mockResolvedValueOnce("octo@example.com");
    await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
    expect(publicEmail).toHaveBeenCalledWith("octo");
    expect(send.mock.calls[0]![0]).toBe("octo@example.com");
  });

  it("answers no-email with no address anywhere", async () => {
    db.contact = "";
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).toEqual({ status: 200, json: { notice: "no-email" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("answers not-sent with no mailer", async () => {
    expect(await notifyGrant(deps({ send: null }), "u1", SHARE, { githubId: 7 })).toEqual({ status: 200, json: { notice: "not-sent" } });
  });

  it("answers not-sent once the sharer hit the daily cap", async () => {
    db.count = DAILY_CAP;
    expect((await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).json).toEqual({ notice: "not-sent" });
    db.count = null;
    expect((await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).json).toEqual({ notice: "emailed" });
  });

  it("uses the clock when no now is given", async () => {
    const rest = { ...deps(), now: undefined };
    expect((await notifyGrant(rest, "u1", SHARE, { githubId: 7 })).json).toEqual({ notice: "emailed" });
    expect(typeof db.updates[0]!.row.notified_at).toBe("string");
  });

  it("is a 404 when the share row is gone", async () => {
    db.share = null;
    expect(await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).toEqual({ status: 404, json: { error: "No such share." } });
  });

  it("answers not-sent and stamps nothing when the send fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("Resend 500"));
    expect((await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).json).toEqual({ notice: "not-sent" });
    expect(err).toHaveBeenCalledWith("share-grant-notify: Resend 500");
    send.mockRejectedValueOnce("nope");
    expect((await notifyGrant(deps(), "u1", SHARE, { githubId: 7 })).json).toEqual({ notice: "not-sent" });
    expect(err).toHaveBeenLastCalledWith("share-grant-notify: nope");
    expect(db.updates).toEqual([]);
  });

  it("names the sharer by name, login or Someone", async () => {
    const subjectFor = async () => {
      send.mockClear();
      await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
      return send.mock.calls[0]![1];
    };
    db.user = { user_metadata: { name: "Bea", user_name: "-bad-" } };
    expect(await subjectFor()).toMatch(/^Bea shared/);
    db.user = { user_metadata: { full_name: "  ", user_name: "cee" } };
    expect(await subjectFor()).toMatch(/^cee shared/);
    db.user = {};
    expect(await subjectFor()).toMatch(/^Someone shared/);
    db.user = null;
    expect(await subjectFor()).toMatch(/^Someone shared/);
    db.userThrows = true;
    expect(await subjectFor()).toMatch(/^Someone shared/);
  });

  it("falls back to a stock title and drops a long emoji", async () => {
    db.card = { card: { title: "   ", emoji: "x".repeat(9) } };
    await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
    expect(send.mock.calls[0]![1]).toBe("Ada shared a thread with you: A Weft thread");
    expect(send.mock.calls[0]![2]).not.toContain("xxxxxxxxx");
    db.card = { card: null };
    send.mockClear();
    await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
    expect(send.mock.calls[0]![1]).toContain("A Weft thread");
    db.card = null;
    send.mockClear();
    await notifyGrant(deps(), "u1", SHARE, { githubId: 7 });
    expect(send.mock.calls[0]![1]).toContain("A Weft thread");
  });
});

describe("resendSender", () => {
  it("is null without a key", () => {
    expect(resendSender({})).toBeNull();
  });

  it("posts to Resend and throws on a refusal", async () => {
    const fetchFn = vi.fn<Fetch>(() => Promise.resolve(new Response("{}", { status: 200 })));
    const s = resendSender({ RESEND_API_KEY: "k" }, fetchFn as unknown as typeof fetch)!;
    await s("a@b.c", "Sub", "text", "<p>html</p>");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ authorization: "Bearer k" });
    expect(JSON.parse(init.body as string)).toEqual({ from: "Weft <team@weft.zip>", to: ["a@b.c"], subject: "Sub", text: "text", html: "<p>html</p>" });
    fetchFn.mockResolvedValueOnce(new Response("no", { status: 422 }));
    await expect(s("a@b.c", "Sub", "text", "html")).rejects.toThrow("Resend 422");
  });

  it("defaults to process.env and the global fetch", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(resendSender()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("githubPublicEmail", () => {
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("asks nothing for an impossible login", async () => {
    const fetchFn = vi.fn();
    expect(await githubPublicEmail({}, fetchFn as unknown as typeof fetch)("-bad")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is the public email, anonymously or with the lookup token", async () => {
    const fetchFn = vi.fn<Fetch>(() => json({ email: "o@x.io" }));
    expect(await githubPublicEmail({}, fetchFn as unknown as typeof fetch)("octo")).toBe("o@x.io");
    expect(fetchFn.mock.calls[0]![0]).toBe("https://api.github.com/users/octo");
    expect(fetchFn.mock.calls[0]![1].headers).not.toHaveProperty("authorization");
    await githubPublicEmail({ GITHUB_LOOKUP_TOKEN: "t" }, fetchFn as unknown as typeof fetch)("octo");
    expect(fetchFn.mock.calls[1]![1].headers).toMatchObject({ authorization: "Bearer t" });
  });

  it("is null for a refusal, a hidden or odd email, or a network error", async () => {
    expect(await githubPublicEmail({}, () => json({}, 404))("octo")).toBeNull();
    expect(await githubPublicEmail({}, () => json({ email: null }))("octo")).toBeNull();
    expect(await githubPublicEmail({}, () => json({ email: "nope" }))("octo")).toBeNull();
    expect(await githubPublicEmail({}, () => Promise.reject(new Error("offline")))("octo")).toBeNull();
  });

  it("defaults to process.env and the global fetch", () => {
    expect(typeof githubPublicEmail()).toBe("function");
  });
});
