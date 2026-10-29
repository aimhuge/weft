import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { formsOf, redactor } from "./secret-redact.cjs";

const PASS = "s3cr3t p@ss/word+x";

describe("redactor", () => {
  it("swaps a value as written for ‹NAME›", () => {
    const redact = redactor([{ name: "DB_PASS", value: PASS }]);
    expect(redact(`password is ${PASS}, again ${PASS}`)).toBe("password is ‹DB_PASS›, again ‹DB_PASS›");
    expect(redact(undefined as unknown as string)).toBe("");
  });

  it("catches the URL-encoded, form-encoded, lowercase-hex and JSON-escaped forms", () => {
    const redact = redactor([{ name: "P", value: PASS }]);
    expect(redact(`postgres://u:${encodeURIComponent(PASS)}@h/db`)).toBe("postgres://u:‹P›@h/db");
    expect(redact(`q=${encodeURIComponent(PASS).replace(/%20/g, "+")}`)).toBe("q=‹P›");
    expect(redact(encodeURIComponent(PASS).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()))).toBe("‹P›");
    const quoted = 'say "hi"\\now';
    expect(redactor([{ name: "Q", value: quoted }])(JSON.stringify({ v: quoted }))).toBe('{"v":"‹Q›"}');
  });

  it("catches base64 of the value, alone or inside a longer string, standard and url-safe", () => {
    const redact = redactor([{ name: "P", value: PASS }]);
    expect(redact(`Basic ${Buffer.from(PASS).toString("base64")}`)).toBe("Basic ‹P›");
    for (const prefix of ["u:", "us:", "use:"]) {
      const encoded = Buffer.from(`${prefix}${PASS}!tail`).toString("base64");
      expect(redact(encoded)).toContain("‹P›");
      const safe = Buffer.from(`${prefix}${PASS}!tail`).toString("base64url");
      expect(redact(safe)).toContain("‹P›");
    }
  });

  // A value that is written in another encoding is still the value: a thread that prints it as hex
  // or zipped must not see it in the clear (2026-10-28).
  it("catches the value as hex, as gzip+base64, reversed, rot13 and \\uXXXX", () => {
    const redact = redactor([{ name: "P", value: PASS }]);
    const bytes = Buffer.from(PASS, "utf8");

    // Hex, plain, 0x-prefixed and as a hex dump shows it.
    expect(redact(bytes.toString("hex"))).toBe("‹P›");
    expect(redact(`0x${bytes.toString("hex")}`)).toBe("‹P›");
    expect(redact([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":"))).toBe("‹P›");

    // Zipped and base64'd, the way a script smuggles one past a grep.
    const zipped = zlib.gzipSync(bytes).toString("base64");
    expect(redact(zipped)).toContain("‹P›");
    expect(redact(`curl -H 'x: ${zipped}'`)).toContain("‹P›");

    // Backwards.
    expect(redact(Buffer.from(PASS, "utf8").reverse().toString("utf8"))).toBe("‹P›");

    // rot13.
    const rot13 = PASS.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
    });
    expect(redact(rot13)).toBe("‹P›");

    // \uXXXX escapes, as JSON.stringify writes them and as the shell's printf %b writes them.
    const escaped = Array.from(PASS)
      .map((c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`)
      .join("");
    expect(redact(escaped)).toBe("‹P›");
  });

  it("leaves very short values alone, and longer names win over their prefixes", () => {
    expect(formsOf("abc")).toEqual([]);
    expect(formsOf(undefined as unknown as string)).toEqual([]);
    const redact = redactor([
      { name: "SHORT", value: "abcd1234" },
      { name: "LONG", value: "abcd1234-and-more" },
    ]);
    expect(redact("abcd1234-and-more / abcd1234")).toBe("‹LONG› / ‹SHORT›");
    expect(redact("nothing here")).toBe("nothing here");
  });
});
