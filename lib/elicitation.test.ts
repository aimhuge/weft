import { describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";
import { elicitationContent, elicitationFields, elicitationResult, onElicitation, pendingElicitation } from "./elicitation";

const schema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", description: "Who you are" },
    age: { type: "integer" },
    ratio: { type: "number", default: 0.5 },
    ok: { type: "boolean", title: "Confirm" },
    color: { type: "string", enum: ["r", "g"], enumNames: ["Red", "Green"] },
    size: { type: "string", oneOf: [{ const: "s", title: "Small" }, { const: "l" }, "junk"] },
    tags: { type: "array", items: { anyOf: [{ const: "a", title: "A" }] }, default: ["a"] },
  },
  required: ["name", "ok", "color"],
};

describe("elicitationFields", () => {
  it("reads each property's kind, title, choices, default and whether it's required", () => {
    const fields = elicitationFields(schema);
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ["name", "string", true],
      ["age", "integer", false],
      ["ratio", "number", false],
      ["ok", "boolean", true],
      ["color", "enum", true],
      ["size", "enum", false],
      ["tags", "multi", false],
    ]);
    expect(fields[0]).toMatchObject({ title: "Name", description: "Who you are" });
    expect(fields[1]!.title).toBe("age");
    expect(fields[2]!.default).toBe("0.5");
    expect(fields[4]!.options).toEqual([{ value: "r", label: "Red" }, { value: "g", label: "Green" }]);
    expect(fields[5]!.options).toEqual([{ value: "s", label: "Small" }, { value: "l", label: "l" }]);
    expect(fields[6]).toMatchObject({ options: [{ value: "a", label: "A" }], default: '["a"]' });
  });

  it("is empty with no schema, or one without properties", () => {
    expect(elicitationFields(undefined)).toEqual([]);
    expect(elicitationFields({ type: "object" })).toEqual([]);
  });

  it("treats a property that isn't an object as text, and an array with no items as an empty multi-select", () => {
    expect(elicitationFields({ properties: { a: 1, b: { type: "array" } } }).map((f) => [f.kind, f.options])).toEqual([
      ["string", undefined],
      ["multi", []],
    ]);
  });
});

describe("elicitationContent", () => {
  const fields = elicitationFields(schema);

  it("types each answer for its field", () => {
    expect(elicitationContent(fields, { name: "Ann", age: "3", ratio: "1.5", ok: "true", color: "g", size: "", tags: '["a"]' })).toEqual({
      name: "Ann",
      age: 3,
      ratio: 1.5,
      ok: true,
      color: "g",
      tags: ["a"],
    });
  });

  it("refuses a required field left empty, but sends an unticked required box as false", () => {
    expect(() => elicitationContent(fields, { name: " ", ok: "true", color: "r" })).toThrow("Name is required.");
    expect(() => elicitationContent(fields, { name: "a", color: "" })).toThrow("color is required.");
    expect(elicitationContent(fields, { name: "a", color: "r" })).toEqual({ name: "a", ok: false, color: "r" });
  });

  it("refuses a value that doesn't fit its field", () => {
    const base = { name: "a", color: "r" };
    expect(() => elicitationContent(fields, { ...base, age: "1.5" })).toThrow("age needs a whole number.");
    expect(() => elicitationContent(fields, { ...base, ratio: "x" })).toThrow("ratio needs a number.");
    expect(() => elicitationContent(fields, { ...base, color: "blue" })).toThrow("color isn't one of its choices.");
    expect(() => elicitationContent(fields, { ...base, tags: '"a"' })).toThrow("tags needs a list.");
  });

  it("labels plain enum choices with their values, and reads an empty multi-select answer as none", () => {
    const [plain] = elicitationFields({ properties: { p: { enum: [1, 2] } } });
    expect(plain!.options).toEqual([{ value: "1", label: "1" }, { value: "2", label: "2" }]);
    expect(typeof elicitationContent([{ name: "m", title: "M", required: true, kind: "multi" }], { m: "[]" }).m).toBe("object");
  });

  it("leaves out an optional field left empty, and sends nothing for no fields", () => {
    expect(elicitationContent(elicitationFields({ properties: { n: { type: "string" } } }), {})).toEqual({});
    expect(elicitationContent([])).toEqual({});
  });
});

describe("pendingElicitation", () => {
  it("keeps the server, message and form", () => {
    expect(pendingElicitation({ serverName: "supabase", message: "Run it?", requestedSchema: schema }).fields).toHaveLength(7);
  });

  it("keeps a URL request's link and no form", () => {
    expect(pendingElicitation({ serverName: "s", message: "Sign in", mode: "url", url: "https://x.test", requestedSchema: schema })).toEqual({
      server: "s",
      message: "Sign in",
      mode: "url",
      url: "https://x.test",
      fields: [],
    });
  });
});

describe("elicitationResult", () => {
  const form = pendingElicitation({ serverName: "s", message: "m", requestedSchema: { properties: { n: { type: "integer" } }, required: ["n"] } });
  const plain = pendingElicitation({ serverName: "s", message: "m" });

  it("accepts, with the form's typed values when there is a form", () => {
    expect(elicitationResult({ behavior: "allow", updatedInput: {} }, plain)).toEqual({ action: "accept" });
    expect(elicitationResult({ behavior: "allow", updatedInput: { answers: { n: "4" } } }, form)).toEqual({ action: "accept", content: { n: 4 } });
  });

  it("declines a denial, cancels a stopped call, and declines a form that still doesn't fit", () => {
    expect(elicitationResult({ behavior: "deny", message: "The user denied this in Weft." }, plain)).toEqual({ action: "decline" });
    expect(elicitationResult({ behavior: "deny", message: "Cancelled." }, plain)).toEqual({ action: "cancel" });
    expect(elicitationResult({ behavior: "allow", updatedInput: {} }, form)).toEqual({ action: "decline" });
  });
});

describe("onElicitation", () => {
  const signal = new AbortController().signal;

  it("declines for a spare with no card", async () => {
    const ask = vi.fn();
    expect(await onElicitation({ cardId: null } as unknown as Session, ask)({ serverName: "s", message: "m" }, { signal })).toEqual({ action: "decline" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks on the card with the server's message and form, and returns the answer", async () => {
    const session = { cardId: "c1" } as unknown as Session;
    const ask = vi.fn().mockResolvedValue({ behavior: "allow", updatedInput: {} });
    const result = await onElicitation(session, ask)({ serverName: "supabase", message: "Destructive SQL. Run it?" }, { signal });
    expect(result).toEqual({ action: "accept" });
    expect(ask).toHaveBeenCalledWith("c1", session, "mcp__supabase__elicitation", { message: "Destructive SQL. Run it?" }, signal, "supabase: Destructive SQL. Run it?", {
      elicitation: { server: "supabase", message: "Destructive SQL. Run it?", fields: [] },
    });
  });

  it("titles the prompt with the server's permission header, and passes its URL and schema along", async () => {
    const ask = vi.fn().mockResolvedValue({ behavior: "deny", message: "no" });
    const request = { serverName: "s", message: "m", url: "https://u.test", requestedSchema: { properties: {} }, title: "Run SQL", displayName: "DB" };
    expect(await onElicitation({ cardId: "c1" } as unknown as Session, ask)(request, { signal })).toEqual({ action: "decline" });
    expect(ask.mock.calls[0]![3]).toEqual({ message: "m", url: "https://u.test", requestedSchema: { properties: {} } });
    expect(ask.mock.calls[0]![5]).toBe("Run SQL");
    delete (request as Partial<typeof request>).title;
    await onElicitation({ cardId: "c1" } as unknown as Session, ask)(request, { signal });
    expect(ask.mock.calls[1]![5]).toBe("DB: m");
  });
});
