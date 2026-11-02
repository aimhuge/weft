import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "./connector.harness";
import { connectorMailer, notice } from "./connector-notify";

describe("connectorMailer", () => {
  it("is off without RESEND_API_KEY", () => {
    expect(connectorMailer(fakeDb().db, {})).toBeUndefined();
  });

  it("emails the account's address through Resend, and nothing when it has none", async () => {
    const { db, state } = fakeDb();
    state.emails.set("u1", "ada@example.com");
    const fetchFn = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const send = connectorMailer(db, { RESEND_API_KEY: "re_x" }, fetchFn)!;
    await send("u1", "Weft: hi", "body");
    expect(fetchFn).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ from: "Weft <team@weft.zip>", to: ["ada@example.com"], subject: "Weft: hi", text: "body" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_x");
    await send("u2", "s", "t");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws when Resend refuses", async () => {
    const { db, state } = fakeDb();
    state.emails.set("u1", "ada@example.com");
    const send = connectorMailer(db, { RESEND_API_KEY: "re_x" }, () => Promise.resolve(new Response("no", { status: 422 })))!;
    await expect(send("u1", "s", "t")).rejects.toThrow("Resend 422");
  });

  it("reads process.env and fetch by default", () => {
    expect(["undefined", "function"]).toContain(typeof connectorMailer(fakeDb().db));
  });
});

describe("notice", () => {
  it("logs a notice in the ledger and emails it with what to do if it wasn't you", async () => {
    const { db, state } = fakeDb();
    const notify = vi.fn(() => Promise.resolve());
    await notice({ db, notify }, "u1", { subject: "a thing", text: "It happened.", workerId: "w1" });
    expect(state.mints[0]).toMatchObject({ outcome: "notice", worker_id: "w1", reason: "a thing", user_id: "u1" });
    expect(notify).toHaveBeenCalledWith("u1", "Weft: a thing", expect.stringContaining("If this wasn't you"));
  });

  it("never fails what it's about: a ledger or mail error is swallowed, and no mailer is fine", async () => {
    const { db } = fakeDb();
    await expect(notice({ db: { ...db, logMint: () => Promise.reject(new Error("x")) }, notify: () => Promise.reject(new Error("y")) }, "u1", { subject: "s", text: "t" })).resolves.toBeUndefined();
    await expect(notice({ db }, "u1", { subject: "s", text: "t" })).resolves.toBeUndefined();
  });
});
