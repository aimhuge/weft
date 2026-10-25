import { describe, expect, it } from "vitest";
import {
  COMMITS_SHOWN,
  PREVIEW_MAX,
  cardRootMessage,
  cardUpdateMessage,
  commitsMessage,
  deployMessage,
  escape,
  growthMessage,
  growthSummaryMessage,
  newTeamMessage,
  newUserMessage,
  noticeMessage,
  paymentMessage,
  previewOf,
  pushMessage,
  testMessage,
} from "./slack-messages";

// What Weft says in Slack: Block Kit plus the plain text Slack shows in notifications. Pure, so no mocks.

const blocksText = (blocks: unknown[]) => JSON.stringify(blocks);

describe("escape", () => {
  it("leaves plain text alone", () => {
    expect(escape("hello world")).toBe("hello world");
  });

  it("escapes &, < and >", () => {
    expect(escape("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("does not double-escape the & it writes", () => {
    expect(escape("<a>")).toBe("&lt;a&gt;");
    expect(escape("&lt;")).toBe("&amp;lt;");
  });
});

describe("previewOf", () => {
  it("keeps a short text as it is", () => {
    expect(previewOf("  done  ")).toBe("done");
  });

  it("drops code fences and the BOARD STATUS line", () => {
    expect(previewOf("before\n```js\ncode()\n```\nafter")).toBe("before\n\nafter");
    expect(previewOf("text\nBOARD STATUS: running\nmore")).toBe("text\n\nmore");
  });

  it("collapses three or more blank lines into one", () => {
    expect(previewOf("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("cuts a long text at a word and marks it", () => {
    const text = `${"word ".repeat(300)}end`;
    const out = previewOf(text);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_MAX);
    expect(out).not.toContain("  ");
  });

  it("cuts hard when there is no space to cut at", () => {
    const text = "x".repeat(PREVIEW_MAX + 100);
    const out = previewOf(text);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(PREVIEW_MAX - 40 + 1);
  });
});

describe("commitsMessage", () => {
  const commit = (sha: string, subject: string) => ({ sha, subject });

  it("names one commit", () => {
    const out = commitsMessage("/dev/app", "main", [commit("abcdef1234", "fix login")]);
    expect(out.text).toBe("app: fix login");
    expect(blocksText(out.blocks)).toContain("1 commit");
    expect(blocksText(out.blocks)).toContain("`abcdef1` fix login");
  });

  it("names many commits and counts the ones it doesn't show", () => {
    const commits = Array.from({ length: COMMITS_SHOWN + 3 }, (_, i) => commit(`sha${i}00`, `c${i}`));
    const out = commitsMessage("/dev/app", "main", commits);
    expect(blocksText(out.blocks)).toContain(`${String(commits.length)} commits`);
    expect(blocksText(out.blocks)).toContain("_and 3 more_");
  });

  it("falls back to 'commit' with no commits at all", () => {
    expect(commitsMessage("/dev/app", "main", []).text).toBe("app: commit");
  });

  it("escapes the project and branch", () => {
    const out = commitsMessage("/dev/a&b", "feat/<x>", [commit("abcdef1", "s")]);
    expect(blocksText(out.blocks)).toContain("a&amp;b");
    expect(blocksText(out.blocks)).toContain("feat/&lt;x&gt;");
  });
});

describe("pushMessage", () => {
  it("names one commit", () => {
    const out = pushMessage("/dev/app", "origin/main", 1);
    expect(out.text).toBe("app: pushed 1 commit to origin/main");
    expect(blocksText(out.blocks)).toContain("⬆️");
  });

  it("names many commits", () => {
    expect(pushMessage("/dev/app", "origin/main", 4).text).toBe("app: pushed 4 commits to origin/main");
  });
});

describe("deployMessage", () => {
  it("says a deploy went to production", () => {
    const out = deployMessage({ project: "app", state: "READY", target: "production", url: "https://x.dev", page: "https://x.dev/p" });
    expect(out.text).toBe("app: deployed");
    expect(blocksText(out.blocks)).toContain("🚀");
    expect(blocksText(out.blocks)).toContain("production");
    expect(blocksText(out.blocks)).toContain("on Vercel");
  });

  it("says a preview deploy, without a url or page", () => {
    const out = deployMessage({ project: "app", state: "BUILDING", target: null, url: null, page: null });
    expect(out.text).toBe("app: deploy failed");
    expect(blocksText(out.blocks)).not.toContain("open");
    expect(blocksText(out.blocks)).not.toContain("build logs");
  });

  it("says a failed deploy and links its build logs", () => {
    const out = deployMessage({ project: "app", state: "ERROR", target: "production", url: null, page: "https://x.dev/logs" });
    expect(blocksText(out.blocks)).toContain("deploy failed (error)");
    expect(blocksText(out.blocks)).toContain("build logs");
  });

  it("adds https:// to a url that has no scheme", () => {
    const out = deployMessage({ project: "app", state: "READY", target: "production", url: "x.dev", page: null });
    expect(blocksText(out.blocks)).toContain("<https://x.dev|open>");
  });
});

describe("cardRootMessage", () => {
  it("links the card and names who started it", () => {
    const out = cardRootMessage("Fix login", "/dev/app", "https://weft.zip/x/board?card=1", "U123");
    expect(out.text).toBe("Weft card: Fix login");
    expect(blocksText(out.blocks)).toContain("<https://weft.zip/x/board?card=1|Fix login>");
    expect(blocksText(out.blocks)).toContain("started by <@U123>");
    expect(blocksText(out.blocks)).not.toContain("turn on sync");
  });

  it("says to turn on sync when there is no link", () => {
    const out = cardRootMessage("Fix login", "/dev/app", null);
    expect(blocksText(out.blocks)).toContain("*Fix login*");
    expect(blocksText(out.blocks)).toContain("turn on sync");
    expect(blocksText(out.blocks)).not.toContain("started by");
  });
});

describe("cardUpdateMessage", () => {
  const base = { title: "Fix login", cwd: "/dev/app", column: "review" as const, preview: "", link: null };

  it("names the column alone when there is nothing else", () => {
    const out = cardUpdateMessage(base);
    expect(out.text).toBe("Fix login: 👀 Ready for review");
    expect(out.blocks).toHaveLength(1);
  });

  it("adds the stage and what's left", () => {
    const out = cardUpdateMessage({ ...base, column: "done", stage: "Testing", remaining: "2 files" });
    expect(out.text).toBe("Fix login: ✅ Done");
    expect(blocksText(out.blocks)).toContain("Testing · left: 2 files");
  });

  it("leaves out 'left: none'", () => {
    const out = cardUpdateMessage({ ...base, remaining: "none" });
    expect(blocksText(out.blocks)).not.toContain("left:");
  });

  it("quotes the preview and links the card", () => {
    const out = cardUpdateMessage({ ...base, preview: "line one\nline two", link: "https://weft.zip/x/board?card=1" });
    expect(blocksText(out.blocks)).toContain("> line one\\n> line two");
    expect(blocksText(out.blocks)).toContain("Open the card on weft.zip");
  });
});

describe("noticeMessage", () => {
  it("escapes the text in the block and in the notification text", () => {
    const out = noticeMessage("a < b");
    expect(out.text).toBe("a &lt; b");
    expect(blocksText(out.blocks)).toContain("a &lt; b");
  });
});

describe("testMessage", () => {
  it("greets the channel", () => {
    const out = testMessage();
    expect(out.text).toBe("Weft is connected");
    expect(blocksText(out.blocks)).toContain("👋");
  });
});

describe("link labels", () => {
  it("swaps a title's | for a lookalike, so the weft.zip link still parses", () => {
    const out = cardRootMessage("Fix | broken", "/dev/app", "https://weft.zip/acme/board?card=c1");
    expect(blocksText(out.blocks)).toContain("<https://weft.zip/acme/board?card=c1|Fix ∣ broken>");
  });
});

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
    expect(blocksText(user.blocks)).toContain("New user");
    expect(blocksText(team.blocks)).toContain("New team");
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
