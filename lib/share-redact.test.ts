// lib/share-redact.ts: the share viewer's redactor. Every key-shaped value in a thread item is
// replaced with `‹hidden: <kind>›`. A tool result over TOOL_RESULT_INLINE_MAX is replaced with the
// redactor's tag. The redactor loops so two adjacent patterns (a token glued to a private key)
// both fire.
import { describe, expect, it } from "vitest";
import { TOOL_RESULT_INLINE_MAX } from "./cloud-sync-types";
import { REDACTED, redactItem, redactItems, redactPageText, redactText } from "./share-redact";
import type { ThreadItem } from "./types";

// Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
const STRIPE_KEY = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
const GITHUB_TOKEN = ["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join("_");
const ENV_NAME = "MY_API_" + "KEY";
const ENV_LINE = `${ENV_NAME}=${"abcdef" + "123456"}`;

describe("redactText", () => {
  it("leaves ordinary text alone", () => {
    expect(redactText("hello world")).toBe("hello world");
    expect(redactText("")).toBe("");
  });

  it("replaces a Stripe live key with a hidden tag", () => {
    const out = redactText(`here is ${STRIPE_KEY} a token`);
    expect(out).toContain("‹hidden: a Stripe secret key›");
    expect(out).not.toContain(STRIPE_KEY);
  });

  it("replaces a private key, a GitHub token, an Anthropic key and a database URL", () => {
    expect(redactText("-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----")).toContain("‹hidden: a private key›");
    expect(redactText(`token ${GITHUB_TOKEN}`)).toContain("‹hidden: a GitHub token›");
    expect(redactText("key sk-ant-abcdefghijklmnopqrstuv")).toContain("‹hidden: an Anthropic API key›");
    expect(redactText("db postgres://user:secret1234@db.example.com:5432/app")).toContain("‹hidden: a database URL with a password›");
  });

  it("replaces a secret-looking env line", () => {
    expect(redactText(ENV_LINE)).toContain(`‹hidden: a secret (${ENV_NAME})›`);
  });

  it("ignores placeholder values that aren't real secrets", () => {
    expect(redactText("API_KEY=replace_me")).toBe("API_KEY=replace_me");
    expect(redactText("API_KEY=xxxxxx")).toBe("API_KEY=xxxxxx");
  });

  it("redacts two adjacent keys in one pass", () => {
    const out = redactText(`${STRIPE_KEY} ${GITHUB_TOKEN}`);
    expect(out).not.toContain("sk_live_");
    expect(out).not.toContain("ghp_");
  });

  it("is a no-op for non-strings and empty inputs", () => {
    expect(redactText("")).toBe("");
    // The function is typed as string; at runtime passing a non-string would still be returned
    // as-is through the early-return guard.
    // @ts-expect-error testing runtime guard
    expect(redactText(undefined)).toBeUndefined();
  });

  it("redacts a long high-entropy opaque token (M-2 narrowing)", () => {
    // A custom in-house API key: 44 chars, URL-safe base64 alphabet, no known pattern. The entropy
    // pass picks it up; the pattern pass alone would not.
    const token = "Qx9zT3vKfL2mY8wRjP5cE7nB4hG1aDsUo6iW0eTrYlA"; // gitleaks:allow
    const out = redactText(`key=${token} end`);
    expect(out).toContain("‹hidden: an opaque value›");
    expect(out).not.toContain(token);
  });

  it("leaves a long URL path alone (slashes break the run, no high-entropy run)", () => {
    const url = "https://example.com/v1/projects/abcdefghijklmnop/abcdefghijklmnop/abcdefghijklmnop";
    const out = redactText(url);
    expect(out).toBe(url);
  });

  it("leaves a 64-char hex hash alone (whitelisted)", () => {
    const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(redactText(`sha256:${hash}`)).toBe(`sha256:${hash}`);
  });

  it("leaves a UUID alone (whitelisted)", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(redactText(`id ${uuid} end`)).toBe(`id ${uuid} end`);
  });
});

describe("redactPageText", () => {
  // Random bytes as base64: the shape of an inlined photo, which the opaque-token pass would chop up.
  const payload = Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 97 + 13) % 256)).toString("base64");

  it("leaves a base64 data URI's payload whole", () => {
    const html = `<img src="data:image/webp;base64,${payload}" alt="us"><div style="background:url(data:image/png;base64,${payload})"></div>`;
    expect(redactText(html)).toContain("‹hidden: an opaque value›");
    expect(redactPageText(html)).toBe(html);
  });

  it("still masks keys around a data URI", () => {
    const html = `<p>${STRIPE_KEY}</p><img src="data:image/webp;base64,${payload}"><p>${GITHUB_TOKEN}</p>`;
    const out = redactPageText(html);
    expect(out).not.toContain(STRIPE_KEY);
    expect(out).not.toContain(GITHUB_TOKEN);
    expect(out).toContain(`data:image/webp;base64,${payload}`);
  });

  it("redacts a page with no data URI the way redactText does", () => {
    expect(redactPageText(`key ${STRIPE_KEY}`)).toBe(redactText(`key ${STRIPE_KEY}`));
  });
});

describe("redactItem", () => {
  it("redacts a user message's text", () => {
    const item: ThreadItem = { kind: "user", text: `here is ${STRIPE_KEY} end`, at: 1 };
    const out = redactItem(item);
    expect(out.kind).toBe("user");
    if (out.kind === "user") expect(out.text).toContain("‹hidden: a Stripe secret key›");
  });

  it("redacts a tool summary and result", () => {
    const item: ThreadItem = {
      kind: "tool",
      id: "t1",
      name: "Bash",
      summary: "echo $GITHUB_TOKEN",
      result: `ran ${GITHUB_TOKEN}`,
      at: 2,
    };
    const out = redactItem(item);
    if (out.kind === "tool") {
      expect(out.result).toContain("‹hidden: a GitHub token›");
    } else {
      throw new Error("expected tool");
    }
  });

  it("redacts images array on tool items", () => {
    const item: ThreadItem = {
      kind: "tool",
      id: "t2",
      name: "Read",
      summary: "readme",
      result: "ok",
      at: 3,
      images: [`https://example.com/${STRIPE_KEY}.png`],
    };
    const out = redactItem(item);
    if (out.kind === "tool") {
      expect(out.images?.[0]).toContain("‹hidden:");
    } else {
      throw new Error("expected tool");
    }
  });

  it("replaces a tool result over TOOL_RESULT_INLINE_MAX with the redactor tag", () => {
    const longResult = "x".repeat(TOOL_RESULT_INLINE_MAX + 1);
    const item: ThreadItem = { kind: "tool", id: "t3", name: "Bash", summary: "cat big", result: longResult, at: 4 };
    const out = redactItem(item);
    if (out.kind === "tool") {
      expect(out.result).toBe(REDACTED);
    } else {
      throw new Error("expected tool");
    }
  });

  it("leaves short tool results alone when they don't contain a key", () => {
    const item: ThreadItem = { kind: "tool", id: "t4", name: "Bash", summary: "ok", result: "all good", at: 5 };
    const out = redactItem(item);
    if (out.kind === "tool") expect(out.result).toBe("all good");
  });
});

describe("redactItems", () => {
  it("applies redactItem to each entry", () => {
    const items: ThreadItem[] = [
      { kind: "user", text: STRIPE_KEY, at: 1 },
      { kind: "assistant", text: "ok", at: 2 },
    ];
    const out = redactItems(items);
    expect(out[0]!.kind).toBe("user");
    if (out[0]!.kind === "user") expect(out[0]!.text).toContain("‹hidden:");
    if (out[1]!.kind === "assistant") expect(out[1]!.text).toBe("ok");
  });
});
