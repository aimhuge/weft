import { describe, expect, it } from "vitest";
import { endsGooseTurn, isGooseNotification, parseGooseEvent } from "./goose-runner-events";

// The stream-json parser, over the lines Goose writes on stdout.

describe("parseGooseEvent", () => {
  it("reads a message line as the assistant's text", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "message", message: "Hello from Goose." }))).toEqual({
      kind: "message",
      text: "Hello from Goose.",
    });
  });

  it("reads a message that carries its text under `text`", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "message", text: "Just text." }))).toEqual({ kind: "message", text: "Just text." });
  });

  it("reads a message whose payload sits under `data`", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "message", data: { text: "Nested." } }))).toEqual({ kind: "message", text: "Nested." });
  });

  it("reads a notification as a progress note", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "notification", progress: "Running the tests." }))).toEqual({
      kind: "notification",
      progress: "Running the tests.",
    });
  });

  it("reads a notification whose progress sits under `data`", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "notification", data: { progress: "Writing a file." } }))).toEqual({
      kind: "notification",
      progress: "Writing a file.",
    });
  });

  it("reads a notification that carries no kind of its own, told apart by the progress key", () => {
    expect(parseGooseEvent(JSON.stringify({ progress: "Thinking." }))).toEqual({ kind: "notification", progress: "Thinking." });
  });

  it("reads an error line as the message it carries", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "error", error: "The provider refused the key." }))).toEqual({
      kind: "error",
      message: "The provider refused the key.",
    });
  });

  it("reads an error line whose message is a plain string", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "error", message: "Rate limited." }))).toEqual({ kind: "error", message: "Rate limited." });
  });

  it("gives an error line with nothing in it a message of its own", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "error" }))).toEqual({ kind: "error", message: "Goose reported an error." });
  });

  it("reads a complete line as the end of the turn", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "complete", text: "All done." }))).toEqual({ kind: "complete", text: "All done." });
  });

  it("reads the other spellings of the end of the turn", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "completed" }))).toEqual({ kind: "complete", text: "" });
    expect(parseGooseEvent(JSON.stringify({ type: "end" }))).toEqual({ kind: "complete", text: "" });
  });

  it("returns null for a malformed line instead of throwing", () => {
    expect(parseGooseEvent("{not json")).toBeNull();
    expect(parseGooseEvent("")).toBeNull();
    expect(parseGooseEvent("   ")).toBeNull();
  });

  it("returns null for JSON that isn't an object", () => {
    expect(parseGooseEvent("[1,2,3]")).toBeNull();
    expect(parseGooseEvent('"a string"')).toBeNull();
    expect(parseGooseEvent("42")).toBeNull();
    expect(parseGooseEvent("null")).toBeNull();
  });

  it("returns null for a JSON null, which is not an object", () => {
    expect(parseGooseEvent("null")).toBeNull();
  });

  it("reads an unknown kind as an event Weft does nothing with", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "something-new" }))).toEqual({ kind: "unknown", type: "something-new" });
  });

  it("reads a line with no kind and no text as unknown", () => {
    expect(parseGooseEvent(JSON.stringify({ nothing: true }))).toEqual({ kind: "unknown", type: "" });
  });

  it("reads the kind from `kind` or `event` when `type` is absent", () => {
    expect(parseGooseEvent(JSON.stringify({ kind: "message", message: "By kind." }))).toEqual({ kind: "message", text: "By kind." });
    expect(parseGooseEvent(JSON.stringify({ event: "complete" }))).toEqual({ kind: "complete", text: "" });
  });

  it("reads a kind whatever its case", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "MESSAGE", message: "Shouty." }))).toEqual({ kind: "message", text: "Shouty." });
  });

  it("reads a number or a boolean as text", () => {
    expect(parseGooseEvent(JSON.stringify({ type: "message", text: 42 }))).toEqual({ kind: "message", text: "42" });
    expect(parseGooseEvent(JSON.stringify({ type: "message", text: true }))).toEqual({ kind: "message", text: "true" });
  });
});

describe("isGooseNotification", () => {
  it("is true for a payload with a progress key", () => {
    expect(isGooseNotification({ progress: "Working." })).toBe(true);
  });

  it("is true for a payload whose progress sits under data", () => {
    expect(isGooseNotification({ data: { progress: "Working." } })).toBe(true);
  });

  it("is false for a payload with no progress key", () => {
    expect(isGooseNotification({ type: "message", message: "Hi." })).toBe(false);
  });

  it("is false for a payload whose progress is null", () => {
    expect(isGooseNotification({ progress: null })).toBe(false);
    expect(isGooseNotification({ data: { progress: null } })).toBe(false);
  });

  it("is false for anything that isn't an object", () => {
    expect(isGooseNotification(null)).toBe(false);
    expect(isGooseNotification("progress")).toBe(false);
    expect(isGooseNotification(7)).toBe(false);
  });
});

describe("endsGooseTurn", () => {
  it("is true for a complete event and false for the rest", () => {
    expect(endsGooseTurn({ kind: "complete", text: "" })).toBe(true);
    expect(endsGooseTurn({ kind: "message", text: "Hi." })).toBe(false);
    expect(endsGooseTurn({ kind: "notification", progress: "Working." })).toBe(false);
    expect(endsGooseTurn({ kind: "error", message: "No." })).toBe(false);
    expect(endsGooseTurn({ kind: "unknown", type: "x" })).toBe(false);
  });

  it("is false for no event at all", () => {
    expect(endsGooseTurn(null)).toBe(false);
  });
});
