// Swaps vault values for ‹NAME› in text a thread or the board will see (docs/architecture/secrets.md): a
// command's output, a dev server's log, a stored tool result. Catches the value as written and the forms
// programs print it in: JSON-escaped, URL-encoded (as in a connection string or a query), base64 (a
// Basic auth header, a token), hex, gzip+base64, reversed, rot13 and \uXXXX — each including the value
// sitting inside a longer string.

// Shorter derived forms would match ordinary text.
const MIN_FORM = 8;
// Shorter values are left alone: redacting "1" or "dev" everywhere would garble every line.
const MIN_VALUE = 4;

function base64Forms(value) {
  const bytes = Buffer.from(value, "utf8");
  const forms = [];
  for (let k = 0; k < 3; k++) {
    const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString("base64");
    // The first chars carry the k padding bytes; the last group mixes with whatever follows the value.
    const start = k === 0 ? 0 : k + 1;
    const end = 4 * Math.floor((k + bytes.length) / 3);
    if (k === 0) forms.push(encoded, encoded.replace(/=+$/, ""));
    forms.push(encoded.slice(start, end));
  }
  return forms.flatMap((f) => [f, f.replace(/\+/g, "-").replace(/\//g, "_")]);
}

// The value as hex, and as hex in the shapes a program prints it: 0x-prefixed, and with the bytes
// separated by colons (what a hex dump shows).
function hexForms(value) {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const spaced = [...Buffer.from(value, "utf8")].map((b) => b.toString(16).padStart(2, "0")).join(":");
  return [hex, `0x${hex}`, spaced];
}

// The value zipped and base64'd, the way a script smuggles one past a grep. The gzip header sits at
// the front, so the encoded value starts a few characters in.
function gzipBase64Forms(value) {
  try {
    const zipped = require("node:zlib").gzipSync(Buffer.from(value, "utf8"));
    const encoded = zipped.toString("base64");
    // The first bytes are the gzip header (10 bytes, so 8 base64 chars), and the last group mixes
    // with whatever follows the value.
    const start = 8;
    const end = 4 * Math.floor(zipped.length / 3);
    const forms = [encoded, encoded.replace(/=+$/, "")];
    if (end > start) forms.push(encoded.slice(start, end));
    return forms;
  } catch {
    return [];
  }
}

// The value backwards: a way to hide one from anything reading for it.
function reverseForms(value) {
  return [Buffer.from(value, "utf8").reverse().toString("utf8")];
}

// rot13, for letters only. A shell's tr does this; a value that is mostly digits comes back
// unchanged and is dropped by the length filter.
function rot13Forms(value) {
  return [
    value.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
    }),
  ];
}

// The value as \uXXXX escapes, and as the shell's printf %b writes them: \x2e for a byte, \u00e9 for a
// code point. A value with a backslash in it gets escaped twice.
function unicodeEscapeForms(value) {
  const codePoints = [...value].map((c) => {
    const cp = c.codePointAt(0);
    return cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`;
  });
  const points = codePoints.join("");
  // printf %b reads \xNN for a byte and \uNNNN for a code point, and takes the rest as themselves.
  const printf = points.replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => `\\x${hex.slice(0, 2)}`);
  return [points, printf];
}

/** Every form of a value worth hiding, longest first. */
function formsOf(value) {
  if (typeof value !== "string" || value.length < MIN_VALUE) return [];
  const uri = encodeURIComponent(value);
  const derived = [
    JSON.stringify(value).slice(1, -1),
    uri,
    uri.replace(/%20/g, "+"),
    uri.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    ...base64Forms(value),
    ...hexForms(value),
    ...gzipBase64Forms(value),
    ...reverseForms(value),
    ...rot13Forms(value),
    ...unicodeEscapeForms(value),
  ].filter((f) => f !== value && f.length >= MIN_FORM);
  return [...new Set([value, ...derived])].sort((a, b) => b.length - a.length);
}

/**
 * A function that redacts the given secrets. entries: [{ name, value }].
 * @returns {(text: string) => string}
 */
function redactor(entries) {
  const pairs = entries.flatMap(({ name, value }) => formsOf(value).map((form) => [form, `‹${name}›`]));
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = String(text ?? "");
    for (const [form, label] of pairs) if (out.includes(form)) out = out.split(form).join(label);
    return out;
  };
}

module.exports = { redactor, formsOf };
