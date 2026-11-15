import { describe, expect, it } from "vitest";
import { batches, buildMessages, deadTokens, isActionable, isPushColumn, pendingKind, pushBody, pushData, scrubSecrets, type PushCard } from "./message";

const org = { id: "org-1", slug: "acme" };
const card = (extra: Partial<PushCard> = {}): PushCard => ({ id: "c1", title: "Fix login", ...extra });

describe("isPushColumn", () => {
  it("takes only needs_you and review", () => {
    expect(isPushColumn("needs_you")).toBe(true);
    expect(isPushColumn("review")).toBe(true);
    expect(isPushColumn("running")).toBe(false);
    expect(isPushColumn(undefined)).toBe(false);
  });
});

describe("pushBody", () => {
  it("says Ready for review in review", () => {
    expect(pushBody(card({ pending: { toolName: "Bash" } }), "review")).toBe("Ready for review");
  });
  it("uses the first non-empty question", () => {
    expect(pushBody(card({ pending: { questions: [{ question: "  " }, { question: "Which  auth?\n" }] } }), "needs_you")).toBe("Which auth?");
  });
  it("names a held tool and its key input", () => {
    const held = (toolName: string, input: Record<string, unknown>, title = toolName) => pushBody(card({ pending: { id: "p1", toolName, title, input } }), "needs_you");
    expect(held("Bash", { command: "pnpm test\n  --run" })).toBe("Bash: pnpm test --run");
    expect(held("Write", { file_path: "/repo/lib/x.ts", content: "secret stuff" })).toBe("Write: /repo/lib/x.ts");
    expect(held("Edit", { file_path: "lib/y.ts" })).toBe("Edit: lib/y.ts");
    expect(held("Read", { file_path: "supabase/migrations/20261029104224_push_devices.sql" })).toBe("Read: supabase/migrations/20261029104224_push_devices.sql");
    expect(held("WebFetch", { url: "https://example.com/a", prompt: "x" })).toBe("WebFetch: https://example.com/a");
    expect(held("mcp__supabase__apply_migration", { project_id: 7, name: "presence", query: "create table" })).toBe("supabase apply_migration: presence");
  });
  it("falls back to the prompt's title, then the bare tool", () => {
    expect(pushBody(card({ pending: { toolName: "Glob", title: "Find *.ts", input: {} } }), "needs_you")).toBe("Glob: Find *.ts");
    expect(pushBody(card({ pending: { toolName: "Bash", title: "Bash" } }), "needs_you")).toBe("Wants to run Bash");
    expect(pushBody(card({ pending: { toolName: "mcp__x__y", input: { n: 1 } } }), "needs_you")).toBe("Wants to run x y");
    expect(pushBody(card({ pending: {} }), "needs_you")).toBe("Wants to run a tool");
  });
  it("never shows a secret in a held command", () => {
    const body = pushBody(card({ pending: { toolName: "Bash", input: { command: "STRIPE_KEY=sk_live_abc123 curl -H 'Authorization: Bearer abc.def.ghi' https://x" } } }), "needs_you");
    expect(body).toBe("Bash: STRIPE_KEY=••• curl -H 'Authorization: •••' https://x");
  });
  it("clips a long command to 178", () => {
    const body = pushBody(card({ pending: { toolName: "Bash", input: { command: `echo ${"word ".repeat(80)}` } } }), "needs_you");
    expect(body).toHaveLength(178);
    expect(body.startsWith("Bash: echo word")).toBe(true);
  });
  it("says an MCP form is asking", () => {
    expect(pushBody(card({ pending: { elicitation: {} } }), "needs_you")).toBe("Asks you to choose");
    expect(pushBody(card({ pending: { elicitation: {}, title: "Pick a repo" } }), "needs_you")).toBe("Pick a repo");
  });
  it("falls back to remaining, the last line, then Needs you", () => {
    expect(pushBody(card({ remaining: "await your OK", lastLine: "x" }), "needs_you")).toBe("await your OK");
    expect(pushBody(card({ lastLine: "Which one?" }), "needs_you")).toBe("Which one?");
    expect(pushBody(card(), "needs_you")).toBe("Needs you");
  });
  it("clips long text", () => {
    const body = pushBody(card({ remaining: "a".repeat(400) }), "needs_you");
    expect(body).toHaveLength(178);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("scrubSecrets", () => {
  it("hides assignments, headers and bare tokens", () => {
    expect(scrubSecrets(`DATABASE_URL="postgres://u:p@h/db" pnpm migrate`)).toBe("DATABASE_URL=••• pnpm migrate");
    expect(scrubSecrets("curl -H \"authorization: token abcdefgh12345\" x")).toBe('curl -H "authorization: •••" x');
    expect(scrubSecrets("gh auth --with-token ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("gh auth --with-token •••");
    expect(scrubSecrets("use sk-ant-api03-abcdefghijklmnop")).toBe("use •••");
    expect(scrubSecrets("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig")).toBe("jwt •••");
    expect(scrubSecrets("key AbC9dEf8GhI7jKl6MnO5pQr4StU3vWx2")).toBe("key •••");
    expect(scrubSecrets("hash 0123456789abcdef0123456789abcdef")).toBe("hash •••");
  });
  it("leaves paths, urls and words alone", () => {
    expect(scrubSecrets("cat lib/cloud-sync-redact.test.ts https://weft.zip/acme/board")).toBe("cat lib/cloud-sync-redact.test.ts https://weft.zip/acme/board");
  });
});

describe("pendingKind", () => {
  it("tells a held tool from questions and a form", () => {
    expect(pendingKind({ toolName: "Bash" })).toBe("permission");
    expect(pendingKind({ toolName: "AskUserQuestion", questions: [{ question: "Which?" }] })).toBe("question");
    expect(pendingKind({ toolName: "x", elicitation: {} })).toBe("form");
    expect(pendingKind(null)).toBeUndefined();
  });
});

describe("isActionable", () => {
  it("is only a held tool in needs_you", () => {
    expect(isActionable(card({ pending: { toolName: "Bash" } }), "needs_you")).toBe(true);
    expect(isActionable(card({ pending: { questions: [{ question: "Which?" }] } }), "needs_you")).toBe(false);
    expect(isActionable(card({ pending: { elicitation: {} } }), "needs_you")).toBe(false);
    expect(isActionable(card(), "needs_you")).toBe(false);
    expect(isActionable(card({ pending: { toolName: "Bash" } }), "review")).toBe(false);
  });
});

describe("pushData", () => {
  it("carries pendingId and kind for a held prompt", () => {
    expect(pushData(card({ pending: { id: "p9", toolName: "Bash" } }), "needs_you", org)).toEqual({ cardId: "c1", org: "acme", orgId: "org-1", column: "needs_you", pendingId: "p9", kind: "permission" });
    expect(pushData(card({ pending: { id: "p2", questions: [{ question: "Q?" }] } }), "needs_you", org)).toMatchObject({ pendingId: "p2", kind: "question" });
    expect(pushData(card({ pending: { id: "p3", elicitation: {} } }), "needs_you", org)).toMatchObject({ pendingId: "p3", kind: "form" });
  });
  it("leaves them off a plain needs_you and review", () => {
    expect(pushData(card(), "needs_you", org)).not.toHaveProperty("kind");
    expect(pushData(card({ pending: { id: "p1", toolName: "Bash" } }), "review", org)).toEqual({ cardId: "c1", org: "acme", orgId: "org-1", column: "review" });
  });
});

describe("buildMessages", () => {
  it("makes one message per token with the card's data", () => {
    const msgs = buildMessages(card({ pending: { id: "p1", toolName: "Bash", input: { command: "pnpm test" } } }), "needs_you", org, ["t1", "t2"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      to: "t1",
      title: "Fix login",
      body: "Bash: pnpm test",
      data: { cardId: "c1", org: "acme", orgId: "org-1", column: "needs_you", pendingId: "p1", kind: "permission" },
      sound: "default",
      priority: "high",
      categoryId: "needs_you",
    });
  });
  it("leaves the category off review and titles an untitled card Weft", () => {
    const [m] = buildMessages(card({ title: "" }), "review", org, ["t1"]);
    expect(m?.title).toBe("Weft");
    expect(m).not.toHaveProperty("categoryId");
  });
  it("leaves the category off questions and forms", () => {
    const [q] = buildMessages(card({ pending: { id: "p1", questions: [{ question: "Which?" }] } }), "needs_you", org, ["t1"]);
    const [f] = buildMessages(card({ pending: { id: "p2", elicitation: {} } }), "needs_you", org, ["t1"]);
    expect(q).not.toHaveProperty("categoryId");
    expect(f).not.toHaveProperty("categoryId");
    expect(q?.data.kind).toBe("question");
  });
});

describe("batches", () => {
  it("splits into chunks of 100", () => {
    const parts = batches(Array.from({ length: 205 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([100, 100, 5]);
    expect(batches([])).toEqual([]);
  });
});

describe("deadTokens", () => {
  it("picks the tokens Expo says aren't registered", () => {
    const msgs = buildMessages(card(), "review", org, ["a", "b", "c", "d"]);
    const dead = deadTokens(msgs, [
      { status: "ok", id: "1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "MessageRateExceeded" } },
    ]);
    expect(dead).toEqual(["b"]);
  });
});
