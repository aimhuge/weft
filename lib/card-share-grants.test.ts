import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Notifier } from "./card-share-grants";
import type { Gh } from "./github-users";

// lib/card-share-grants.ts against a fake owner client (cloud_share_grants answers from `db`), a mocked shareRowFor
// (the real CardShareError kept), a fake gh for login → id, and a fake notifier or fetch.

type Row = { github_id: number; github_login: string; via: "share" | "mention"; created_at: string; notified_at: string | null; opened_at: string | null };

interface Db {
  rows: Row[];
  listError: { message: string } | null;
  upsertError: { message: string } | null;
  readError: { message: string } | null;
  readNull: boolean;
  deleteError: { message: string } | null;
  upserts: { row: Record<string, unknown>; opts: unknown }[];
  deletes: Record<string, unknown>[];
}
const db = vi.hoisted((): Db => ({ rows: [], listError: null, upsertError: null, readError: null, readNull: false, deleteError: null, upserts: [], deletes: [] }));

function query() {
  const filters: Record<string, unknown> = {};
  let op: "select" | "delete" = "select";
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, v: unknown) => {
      filters[col] = v;
      return q;
    },
    order: () => q,
    delete: () => {
      op = "delete";
      return q;
    },
    upsert: (row: Record<string, unknown>, opts: unknown) => {
      db.upserts.push({ row, opts });
      if (!db.upsertError && !db.rows.some((r) => r.github_id === row.github_id)) {
        db.rows.push({ github_id: row.github_id as number, github_login: row.github_login as string, via: row.via as Row["via"], created_at: "2026-11-09", notified_at: null, opened_at: null });
      }
      return Promise.resolve({ error: db.upsertError });
    },
    maybeSingle: () => {
      if (db.readError) return Promise.resolve({ data: null, error: db.readError });
      if (db.readNull) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: db.rows.find((r) => r.github_id === filters.github_id) ?? null, error: null });
    },
    then: (done: (r: unknown) => unknown) => {
      if (op === "delete") {
        db.deletes.push(filters);
        if (!db.deleteError) db.rows = db.rows.filter((r) => r.github_id !== filters.github_id);
        return Promise.resolve({ error: db.deleteError }).then(done);
      }
      return Promise.resolve(db.listError ? { data: null, error: db.listError } : { data: db.rows, error: null }).then(done);
    },
  };
  return q;
}
const client = { from: query };

const shareRowFor = vi.hoisted(() => vi.fn());
vi.mock("./card-share", async () => ({ ...(await vi.importActual<typeof import("./card-share")>("./card-share")), shareRowFor }));
const session = vi.hoisted((): { token: string | null } => ({ token: "tok" }));
vi.mock("./account", () => ({
  accountClient: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: session.token ? { access_token: session.token } : null } }) } }),
}));

const { CardShareError } = await import("./card-share");
const { GRANT_BATCH, cleanLogins, grantShare, listShareGrants, remoteNotifier, revokeShareGrant, toGrant } = await import("./card-share-grants");

const users: Record<string, string> = { octo: "101\tOcto\tUser", ada: "102\tada\tUser", acme: "103\tacme\tOrganization" };
const gh: Gh = (args) => {
  const login = (args[1] as string).replace("users/", "").toLowerCase();
  return users[login] ? Promise.resolve(users[login]) : Promise.reject(new Error("404"));
};
const notify = vi.fn<Notifier>(() => Promise.resolve("emailed"));

beforeEach(() => {
  Object.assign(db, { rows: [], listError: null, upsertError: null, readError: null, readNull: false, deleteError: null, upserts: [], deletes: [] });
  session.token = "tok";
  shareRowFor.mockReset().mockResolvedValue({ kind: "ready", client, shareId: "sh1" });
  notify.mockClear();
});

describe("cleanLogins", () => {
  it("drops @, repeats (any case) and impossible logins", () => {
    expect(cleanLogins(["@Octo", "octo", " ada ", "-bad", 7, ""])).toEqual(["Octo", "ada"]);
    expect(cleanLogins("octo")).toEqual([]);
  });
});

describe("toGrant", () => {
  it("maps a row's columns", () => {
    expect(toGrant({ github_id: 1, github_login: "o", via: "share", created_at: "c", notified_at: null, opened_at: "x" })).toEqual({
      githubId: 1,
      login: "o",
      via: "share",
      createdAt: "c",
      notifiedAt: null,
      openedAt: "x",
    });
  });
});

describe("listShareGrants", () => {
  it("is empty when blocked or the card has no share yet", async () => {
    shareRowFor.mockResolvedValueOnce({ kind: "blocked", state: { kind: "signed-out" } });
    expect(await listShareGrants("c1")).toEqual({ shareId: null, grants: [] });
    shareRowFor.mockResolvedValueOnce({ kind: "ready", client, shareId: null });
    expect(await listShareGrants("c1")).toEqual({ shareId: null, grants: [] });
  });

  it("lists the share's grants and throws a read error", async () => {
    db.rows = [{ github_id: 101, github_login: "Octo", via: "share", created_at: "c", notified_at: null, opened_at: null }];
    expect(await listShareGrants("c1")).toEqual({ shareId: "sh1", grants: [toGrant(db.rows[0]!)] });
    db.listError = { message: "rls" };
    await expect(listShareGrants("c1")).rejects.toThrow("rls");
  });
});

describe("grantShare", () => {
  it("refuses no logins and too many", async () => {
    await expect(grantShare("c1", { logins: [], via: "share" })).rejects.toMatchObject({ status: 400, message: "Name a GitHub user." });
    const many = Array.from({ length: GRANT_BATCH + 1 }, (_, i) => `u${i}`);
    const err = await grantShare("c1", { logins: many, via: "share" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CardShareError);
    expect(err).toMatchObject({ status: 400 });
  });

  it("is a 409 until the card is shared", async () => {
    shareRowFor.mockResolvedValueOnce({ kind: "blocked", state: { kind: "signed-out" } });
    await expect(grantShare("c1", { logins: ["octo"], via: "share" }, { gh, notify })).rejects.toMatchObject({ status: 409 });
    shareRowFor.mockResolvedValueOnce({ kind: "ready", client, shareId: null });
    await expect(grantShare("c1", { logins: ["octo"], via: "share" }, { gh, notify })).rejects.toMatchObject({ status: 409 });
  });

  it("grants by GitHub id, tells the person, and reports unknown accounts", async () => {
    const out = await grantShare("c1", { logins: ["octo", "ghost", "acme"], via: "share", note: "ignored" }, { gh, notify });
    const grant: unknown = expect.objectContaining({ githubId: 101, login: "Octo", via: "share" });
    expect(out).toEqual([
      { login: "Octo", ok: true, grant, notice: "emailed" },
      { login: "ghost", ok: false, error: "No GitHub user @ghost." },
      { login: "acme", ok: false, error: "No GitHub user @acme." },
    ]);
    expect(db.upserts[0]).toEqual({ row: { share_id: "sh1", github_id: 101, github_login: "Octo", via: "share" }, opts: { onConflict: "share_id,github_id", ignoreDuplicates: true } });
    expect(notify).toHaveBeenCalledWith("sh1", 101, null);
  });

  it("passes a mention's clipped note", async () => {
    await grantShare("c1", { logins: ["ada"], via: "mention", note: "  look   here " }, { gh, notify });
    expect(notify).toHaveBeenCalledWith("sh1", 102, "look here");
  });

  it("skips the notifier for a grant already emailed", async () => {
    db.rows = [{ github_id: 101, github_login: "Octo", via: "share", created_at: "c", notified_at: "n", opened_at: null }];
    const [out] = await grantShare("c1", { logins: ["octo"], via: "mention" }, { gh, notify });
    expect(out).toMatchObject({ ok: true, notice: "emailed" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("reports an upsert or read-back failure", async () => {
    db.upsertError = { message: "rls says no" };
    expect(await grantShare("c1", { logins: ["octo"], via: "share" }, { gh, notify })).toEqual([{ login: "octo", ok: false, error: "rls says no" }]);
    db.upsertError = null;
    db.readError = { message: "read failed" };
    expect(await grantShare("c1", { logins: ["octo"], via: "share" }, { gh, notify })).toEqual([{ login: "octo", ok: false, error: "read failed" }]);
    db.readError = null;
    db.readNull = true;
    expect(await grantShare("c1", { logins: ["octo"], via: "share" }, { gh, notify })).toEqual([{ login: "octo", ok: false, error: "The grant didn't save." }]);
  });

  it("defaults to the remote notifier", async () => {
    session.token = null;
    const [out] = await grantShare("c1", { logins: ["octo"], via: "share" }, { gh });
    expect(out).toMatchObject({ ok: true, notice: "not-sent" });
  });
});

describe("revokeShareGrant", () => {
  it("refuses a bad id", async () => {
    await expect(revokeShareGrant("c1", 0)).rejects.toMatchObject({ status: 400, message: "Unknown person." });
    await expect(revokeShareGrant("c1", Number.NaN)).rejects.toMatchObject({ status: 400 });
  });

  it("deletes the grant and answers the rest", async () => {
    db.rows = [
      { github_id: 101, github_login: "Octo", via: "share", created_at: "c", notified_at: null, opened_at: null },
      { github_id: 102, github_login: "ada", via: "share", created_at: "c", notified_at: null, opened_at: null },
    ];
    const out = await revokeShareGrant("c1", 101);
    expect(db.deletes).toEqual([{ share_id: "sh1", github_id: 101 }]);
    expect(out).toEqual({ shareId: "sh1", grants: [expect.objectContaining({ githubId: 102 })] });
  });

  it("throws a delete error", async () => {
    db.deleteError = { message: "nope" };
    await expect(revokeShareGrant("c1", 101)).rejects.toThrow("nope");
  });
});

describe("remoteNotifier", () => {
  const reply = (body: string) => vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(body)));

  it("is not-sent when signed out", async () => {
    session.token = null;
    const fetchFn = reply("{}");
    expect(await remoteNotifier({}, fetchFn as unknown as typeof fetch)("sh1", 1, null)).toBe("not-sent");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("posts to weft.zip on the owner's token and passes emailed / no-email through", async () => {
    const fetchFn = reply(JSON.stringify({ notice: "emailed" }));
    expect(await remoteNotifier({}, fetchFn as unknown as typeof fetch)("sh 1", 7, "hi")).toBe("emailed");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://weft.zip/api/s/sh%201/grants/notify");
    expect(init.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(JSON.parse(init.body as string)).toEqual({ githubId: 7, note: "hi" });
    const local = reply(JSON.stringify({ notice: "no-email" }));
    expect(await remoteNotifier({ WEFT_TEAMS_URL: "http://localhost:3000//" }, local as unknown as typeof fetch)("sh1", 7, null)).toBe("no-email");
    expect(local.mock.calls[0]![0]).toBe("http://localhost:3000/api/s/sh1/grants/notify");
  });

  it("is not-sent for any other reply or a network error", async () => {
    expect(await remoteNotifier({}, reply(JSON.stringify({ notice: "boom" })) as unknown as typeof fetch)("sh1", 1, null)).toBe("not-sent");
    expect(await remoteNotifier({}, reply("not json") as unknown as typeof fetch)("sh1", 1, null)).toBe("not-sent");
    expect(await remoteNotifier({}, reply("null") as unknown as typeof fetch)("sh1", 1, null)).toBe("not-sent");
    const offline = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await remoteNotifier({}, offline)("sh1", 1, null)).toBe("not-sent");
  });
});
