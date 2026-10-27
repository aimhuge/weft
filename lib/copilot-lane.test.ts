import { describe, expect, it } from "vitest";
import { columnMinWidth, hasUnread, LANE_CYCLE, laneStateFromPrefs, lastReply, lastReplyAt } from "./copilot-lane";
import type { ThreadItem } from "./types";

describe("columnMinWidth", () => {
  it("keeps columns roomy when the lane is hidden, narrows them once peek or open", () => {
    expect(columnMinWidth("hidden")).toBe(170);
    expect(columnMinWidth("peek")).toBe(120);
    expect(columnMinWidth("open")).toBe(120);
  });
});

describe("laneStateFromPrefs", () => {
  it("is hidden when both cookies are off, peek when peek is on, open when open is on", () => {
    expect(laneStateFromPrefs(false, false)).toBe("hidden");
    expect(laneStateFromPrefs(false, true)).toBe("peek");
    expect(laneStateFromPrefs(true, false)).toBe("open");
    expect(laneStateFromPrefs(true, true)).toBe("open");
  });
});

describe("LANE_CYCLE", () => {
  it("walks hidden → peek → open → hidden", () => {
    expect(LANE_CYCLE.hidden).toBe("peek");
    expect(LANE_CYCLE.peek).toBe("open");
    expect(LANE_CYCLE.open).toBe("hidden");
  });
});

describe("lastReply", () => {
  it("is null before the copilot said anything", () => {
    expect(lastReply([{ kind: "user", text: "hi", at: 1 }])).toBeNull();
    expect(lastReply([{ kind: "assistant", text: "  ", at: 1 }])).toBeNull();
  });

  it("flattens the latest reply to one plain line without the status line", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "old", at: 1 },
      {
        kind: "assistant",
        text: "**Two** cards finished.\n\nSee [the card](weft://card/1) and `code`.\n```\nx\n```\nBOARD STATUS: column=done",
        at: 2,
      },
    ];
    expect(lastReply(items)).toBe("Two cards finished. See the card and code. x");
  });

  it("drops a session status line", () => {
    const items: ThreadItem[] = [{ kind: "assistant", text: "All clear.\n\n`=-=[ SESSION STATUS: Done ]=-= 23:19`", at: 1 }];
    expect(lastReply(items)).toBe("All clear.");
  });

  it("skips a reply that was only a status line", () => {
    const items: ThreadItem[] = [
      { kind: "assistant", text: "Real answer", at: 1 },
      { kind: "assistant", text: "BOARD STATUS: column=done", at: 2 },
    ];
    expect(lastReply(items)).toBe("Real answer");
  });

  it("cuts a long reply with an ellipsis", () => {
    const reply = lastReply([{ kind: "assistant", text: "word ".repeat(100), at: 1 }], 20);
    expect(reply).toHaveLength(20);
    expect(reply?.endsWith("…")).toBe(true);
  });
});

describe("hasUnread", () => {
  const items: ThreadItem[] = [
    { kind: "user", text: "what next?", at: 10 },
    { kind: "assistant", text: "Build the diff view.", at: 20 },
    { kind: "assistant", text: "  ", at: 30 },
  ];

  it("dates the latest reply with text, or 0 before any", () => {
    expect(lastReplyAt(items)).toBe(20);
    expect(lastReplyAt([])).toBe(0);
  });

  it("lights only for a reply after you last looked", () => {
    expect(hasUnread(items, 0)).toBe(true);
    expect(hasUnread(items, 19)).toBe(true);
    expect(hasUnread(items, 20)).toBe(false);
    expect(hasUnread([], 0)).toBe(false);
  });
});
