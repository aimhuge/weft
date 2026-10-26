import { describe, expect, it } from "vitest";
import { entry } from "./pane-cdp-fakes";

describe("consoleEntry", () => {
  it("reads a console call", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "hello" }],
      stackTrace: { callFrames: [{ url: "http://localhost:3000/app.js", lineNumber: 11 }] },
    });
    expect(e).toEqual({ level: "log", text: "hello", at: "http://localhost:3000/app.js:12" });
  });

  it("calls a warning a warning", () => {
    const e = entry("Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "careful" }] });
    expect(e?.level).toBe("warn");
  });

  it("drops the styles after a %c format", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [
        { type: "string", value: "%cstyled" },
        { type: "string", value: "color: red" },
      ],
    });
    // The style argument goes, and the %c marker itself is taken out of the text.
    expect(e?.text).toBe("styled");
  });

  it("drops every string after a %c format, not just the style", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [
        { type: "string", value: "%cstyled" },
        { type: "string", value: "color: red" },
        { type: "string", value: "tail" },
      ],
    });
    expect(e?.text).toBe("styled");
  });

  it("keeps a non-string after a %c format", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [
        { type: "string", value: "%cstyled" },
        { type: "number", value: 7 },
      ],
    });
    expect(e?.text).toBe("styled 7");
  });

  it("keeps every string when there's no %c", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [
        { type: "string", value: "plain" },
        { type: "string", value: "second" },
      ],
    });
    expect(e?.text).toBe("plain second");
  });

  it("takes the %c out of the text", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "%cloud" }],
    });
    expect(e?.text).toBe("loud");
  });

  it("reads an object by its description", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "object", description: "Object" }],
    });
    expect(e?.text).toBe("Object");
  });

  it("reads an object by its value", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "object", value: { a: 1 } }],
    });
    expect(e?.text).toBe('{"a":1}');
  });

  it("reads an unserializable value", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "symbol", unserializableValue: "Symbol(x)" }],
    });
    expect(e?.text).toBe("Symbol(x)");
  });

  it("falls back to the class name, then the type", () => {
    expect(entry("Runtime.consoleAPICalled", { type: "log", args: [{ type: "object", className: "Foo" }] })?.text).toBe("Foo");
    expect(entry("Runtime.consoleAPICalled", { type: "log", args: [{ type: "undefined" }] })?.text).toBe("undefined");
    expect(entry("Runtime.consoleAPICalled", { type: "log", args: [{ type: "" }] })?.text).toBe("");
    expect(entry("Runtime.consoleAPICalled", { type: "log", args: [null] })?.text).toBe("");
  });

  it("copes with a console call that has no arguments", () => {
    const e = entry("Runtime.consoleAPICalled", { type: "log" });
    expect(e?.text).toBe("");
  });

  it("copes with a first argument that has no value", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "object", description: "Thing" }, { type: "string", value: "second" }],
    });
    expect(e?.text).toBe("Thing second");
  });

  it("ignores Electron's own warnings, which aren't the page's", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "warning",
      args: [{ type: "string", value: "Insecure CSP" }],
      stackTrace: { callFrames: [{ url: "node:electron/js2c/asar_init", lineNumber: 0 }] },
    });
    expect(e).toBeUndefined();
  });

  it("has no place when there's no stack frame", () => {
    const e = entry("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "x" }] });
    expect(e?.at).toBe("");
  });

  it("counts from the first line when the frame has no line number", () => {
    const e = entry("Runtime.consoleAPICalled", {
      type: "log",
      args: [{ type: "string", value: "x" }],
      stackTrace: { callFrames: [{ url: "http://localhost:3000/app.js" }] },
    });
    expect(e?.at).toBe("http://localhost:3000/app.js:1");
  });

  it("reads a thrown exception", () => {
    const e = entry("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "TypeError: x is not a function" },
        url: "http://localhost:3000/app.js",
        lineNumber: 4,
      },
    });
    expect(e).toEqual({ level: "error", text: "Uncaught TypeError: x is not a function", at: "http://localhost:3000/app.js:5" });
  });

  it("falls back to the exception's text, then to a plain message", () => {
    expect(entry("Runtime.exceptionThrown", { exceptionDetails: { text: "Script error." } })?.text).toBe("Uncaught Script error.");
    expect(entry("Runtime.exceptionThrown", {})?.text).toBe("Uncaught Uncaught exception");
  });

  it("reads a browser-side log entry", () => {
    const e = entry("Log.entryAdded", {
      entry: { source: "deprecation", level: "warning", text: "feature is going away", url: "http://localhost:3000/app.js", lineNumber: 2 },
    });
    expect(e).toEqual({ level: "warn", text: "feature is going away", at: "http://localhost:3000/app.js:3" });
  });

  it("leaves failed requests to the network buffer", () => {
    expect(entry("Log.entryAdded", { entry: { source: "network", level: "error", text: "404" } })).toBeUndefined();
  });

  it("has no place for a log entry with no url", () => {
    const e = entry("Log.entryAdded", { entry: { source: "other", level: "info", text: "hi" } });
    expect(e).toEqual({ level: "info", text: "hi", at: "" });
  });

  it("copes with a log entry with no text and no line number", () => {
    const e = entry("Log.entryAdded", { entry: { source: "other", level: "info", url: "http://x/app.js" } });
    expect(e).toEqual({ level: "info", text: "", at: "http://x/app.js:1" });
  });

  it("has no place for a method it doesn't know", () => {
    expect(entry("Network.requestWillBeSent", {})).toBeUndefined();
    expect(entry("Something.else", {})).toBeUndefined();
  });

  it("cuts a very long text short", () => {
    const e = entry("Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "x".repeat(2000) }] });
    expect(e?.text).toHaveLength(1001);
    expect(e?.text.endsWith("…")).toBe(true);
  });
});
