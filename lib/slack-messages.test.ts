import { describe, expect, it } from "vitest";
import {
  COMMITS_SHOWN,
  PREVIEW_MAX,
  cardRootMessage,
  cardUpdateMessage,
  commitsMessage,
  deployMessage,
  escape,
  noticeMessage,
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
