import { describe, expect, it } from "vitest";
import { growthMessage, growthSummaryMessage, newTeamMessage, newUserMessage, paymentMessage } from "./slack-messages";

// The growth half of what Weft says in Slack (lib/slack-messages.ts): the new user, the new team and the
// payment, each one a message of its own, and the daily summary at the end.
// The rest of the messages live in lib/slack-messages.test.ts.

const blocksText = (blocks: unknown[]) => JSON.stringify(blocks);

describe("growth messages", () => {
  it("names a new user by the local part of the address, not the whole address", () => {
    const out = newUserMessage({ kind: "user", id: "u1", email: "someone@example.com", at: "2026-10-20T10:00:00Z" });
    expect(blocksText(out.blocks)).toContain("New user");
    expect(blocksText(out.blocks)).toContain("someone");
    expect(out.text).not.toContain("example.com");
  });

  it("copes with a user whose address is missing", () => {
    const out = newUserMessage({ kind: "user", id: "u1", email: null, at: "2026-10-20T10:00:00Z" });
    expect(blocksText(out.blocks)).toContain("New user");
  });

  it("names a new team and how many people are in it", () => {
    const out = newTeamMessage({ kind: "team", id: "t1", name: "Acme", slug: "acme", members: 3, at: "2026-10-20T10:00:00Z" });
    expect(blocksText(out.blocks)).toContain("New team");
    expect(blocksText(out.blocks)).toContain("Acme");
    expect(blocksText(out.blocks)).toContain("3 members");
  });

  it("names a payment, its plan and its amount", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "invoice.paid",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "active",
      amount_cents: 2000,
      currency: "usd",
      seats: 1,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("Payment received");
    expect(blocksText(out.blocks)).toContain("AimHuge");
    expect(blocksText(out.blocks)).toContain("pro");
    expect(blocksText(out.blocks)).toContain("$20");
  });

  it("says a cancellation is a cancellation", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "subscription.canceled",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "canceled",
      amount_cents: null,
      currency: null,
      seats: 1,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("Subscription canceled");
  });

  it("picks the message for whichever kind the event is", () => {
    const user = growthMessage({ kind: "user", id: "u1", email: "a@b.c", at: "2026-10-20T10:00:00Z" });
    const team = growthMessage({ kind: "team", id: "t1", name: "Acme", slug: "acme", members: 2, at: "2026-10-20T10:00:00Z" });
    const payment = growthMessage({
      kind: "payment",
      id: "p1",
      event: "invoice.paid",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "active",
      amount_cents: 2000,
      currency: "usd",
      seats: 1,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(user.blocks)).toContain("New user");
    expect(blocksText(team.blocks)).toContain("New team");
    expect(blocksText(payment.blocks)).toContain("Payment received");
  });

  it("names a user whose address has no local part", () => {
    // An address with no @ before the domain has no local part to shorten to.
    const out = newUserMessage({ kind: "user", id: "u1", email: "@example.com", at: "2026-10-20T10:00:00Z" });
    expect(blocksText(out.blocks)).toContain("@example.com");
  });

  it("names a user whose address has no @ at all", () => {
    const out = newUserMessage({ kind: "user", id: "u1", email: "plainname", at: "2026-10-20T10:00:00Z" });
    expect(blocksText(out.blocks)).toContain("plainname");
  });

  it("names a payment event it has no word for", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "invoice.payment_failed",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: null,
      status: "failed",
      amount_cents: null,
      currency: null,
      seats: null,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("invoice.payment_failed");
    expect(blocksText(out.blocks)).not.toContain("pro");
  });

  it("counts the seats of a payment that has more than one", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "subscription.created",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "team",
      status: "active",
      amount_cents: 5000,
      currency: "usd",
      seats: 4,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("4 seats");
  });

  it("leaves the seats out when there are none or only one", () => {
    const base = {
      kind: "payment" as const,
      id: "p1",
      event: "invoice.paid",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "active",
      amount_cents: 2000,
      currency: "usd",
      at: "2026-10-20T10:00:00Z",
    };
    expect(blocksText(paymentMessage({ ...base, seats: 1 }).blocks)).not.toContain("seats");
    expect(blocksText(paymentMessage({ ...base, seats: 0 }).blocks)).not.toContain("seats");
    expect(blocksText(paymentMessage({ ...base, seats: null }).blocks)).not.toContain("seats");
  });

  it("names money in another currency", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "invoice.paid",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "active",
      amount_cents: 2000,
      currency: "eur",
      seats: 1,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("EUR 20");
  });

  it("names money with no currency at all", () => {
    const out = paymentMessage({
      kind: "payment",
      id: "p1",
      event: "invoice.paid",
      org: "AimHuge",
      slug: "aimhuge",
      actor: null,
      plan: "pro",
      status: "active",
      amount_cents: 2000,
      currency: null,
      seats: 1,
      at: "2026-10-20T10:00:00Z",
    });
    expect(blocksText(out.blocks)).toContain("20");
    expect(blocksText(out.blocks)).not.toContain("$");
  });
});

describe("the daily growth summary", () => {
  const overview = {
    accounts: 12,
    new_7d: 3,
    new_30d: 9,
    signed_in_7d: 5,
    signed_in_30d: 8,
    never_signed_in: 2,
    workspaces: 6,
    invites_pending: 1,
    syncing_accounts: 4,
    synced_cards: 21,
    paying_workspaces: 2,
  };

  it("carries the headline numbers", () => {
    const out = growthSummaryMessage(overview, "https://weft.zip/apps/growth");
    expect(blocksText(out.blocks)).toContain("3 new in 7 days");
    expect(blocksText(out.blocks)).toContain("12 accounts");
    expect(blocksText(out.blocks)).toContain("2 paying");
  });

  it("links to the growth dashboard", () => {
    const out = growthSummaryMessage(overview, "https://weft.zip/apps/growth");
    expect(blocksText(out.blocks)).toContain("<https://weft.zip/apps/growth|Open the growth dashboard>");
  });

  it("leaves the link out when there is no dashboard to point at", () => {
    const out = growthSummaryMessage(overview, "");
    expect(blocksText(out.blocks)).not.toContain("Open the growth dashboard");
  });
});
