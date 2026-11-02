import { describe, expect, it } from "vitest";
import { hostCommand, hostFailure, hostResult, isHostDone, readHostCommand, remoteRefusal, textArgOf, verbResult } from "./host-command";

const target = { orgId: "org-1", device: "worker:w-1", folder: "weft", cardId: "card-1" };
const read = (payload: unknown) => readHostCommand({ payload });

describe("hostCommand", () => {
  it("builds a host row addressed to the card's host, with args naming that card", () => {
    expect(hostCommand(target, "card.update", { id: "card-9", body: { title: "T" } })).toEqual({
      org_id: "org-1",
      kind: "host",
      target_device: "worker:w-1",
      folder: "weft",
      payload: { verb: "card.update", args: { id: "card-1", body: { title: "T" } } },
    });
    expect(hostCommand(target, "card.stop")).toMatchObject({ payload: { verb: "card.stop", args: { id: "card-1" } } });
  });

  it("is null for a verb no host runs", () => {
    expect(hostCommand(target, "card.explode", {})).toBeNull();
    expect(hostCommand(target, "toString", {})).toBeNull();
  });
});

describe("readHostCommand", () => {
  it("reads a verb and the card it names", () => {
    expect(read({ verb: "card.shell", args: { id: "card-1", command: "ls" } })).toEqual({ verb: "card.shell", args: { id: "card-1", command: "ls" } });
  });

  it("refuses a missing or unknown verb", () => {
    expect(() => read(null)).toThrow("That request names no verb.");
    expect(() => read({ verb: "" })).toThrow("That request names no verb.");
    expect(() => read({ verb: 3 })).toThrow("That request names no verb.");
    expect(() => read({ verb: "rm -rf" })).toThrow("This host doesn't run rm -rf. Update it to the newest Weft.");
  });

  it("refuses args that name no card, and an update with no body", () => {
    expect(() => read({ verb: "card.stop" })).toThrow("That request names no card.");
    expect(() => read({ verb: "card.stop", args: [] })).toThrow("That request names no card.");
    expect(() => read({ verb: "card.stop", args: { id: "" } })).toThrow("That request names no card.");
    expect(() => read({ verb: "card.update", args: { id: "c" } })).toThrow("That update has no changes.");
    expect(() => read({ verb: "card.update", args: { id: "c", body: [] } })).toThrow("That update has no changes.");
  });
});

describe("remoteRefusal", () => {
  it("refuses a card.update that skips permission prompts, but not a safer mode", () => {
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { permissionMode: "bypassPermissions" } } })).toMatch(/can't skip permission prompts/);
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { permissionMode: "auto" } } })).toBeNull();
  });

  it("refuses a shell from the network", () => {
    expect(remoteRefusal({ verb: "card.shell", args: { id: "c", command: "ls" } })).toMatch(/shell command only runs from Weft's own window/);
  });

  it("refuses moving a card's folder, agent or read access from the network", () => {
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { cwd: "/Users/x" } } })).toMatch(/change a card's folder/);
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { agent: "builder" } } })).toMatch(/change a card's agent/);
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { readScope: "/Users/x" } } })).toMatch(/change a card's read access/);
  });

  it("lets the rest through", () => {
    expect(remoteRefusal({ verb: "card.update", args: { id: "c", body: { title: "T", tags: ["a"] } } })).toBeNull();
    expect(remoteRefusal({ verb: "card.update", args: { id: "c" } })).toBeNull();
    expect(remoteRefusal({ verb: "card.stop", args: { id: "c" } })).toBeNull();
  });

  it("lets Send later and the skills list through, but never a scheduled \"!\" command", () => {
    expect(remoteRefusal({ verb: "card.schedule", args: { id: "c", text: "ship it", at: 1 } })).toBeNull();
    expect(remoteRefusal({ verb: "card.schedule", args: { id: "c", at: 1 } })).toBeNull();
    expect(remoteRefusal({ verb: "card.unschedule", args: { id: "c", messageId: "m" } })).toBeNull();
    expect(remoteRefusal({ verb: "skills.list", args: { id: "c" } })).toBeNull();
    for (const text of ["!rm -rf ~", "  !ls", "\\!ls"]) {
      expect(remoteRefusal({ verb: "card.schedule", args: { id: "c", text, at: 1 } })).toMatch(/shell command only runs from Weft's own window/);
    }
    // A pasted picture starts with "![", which is a message, not a command.
    expect(remoteRefusal({ verb: "card.schedule", args: { id: "c", text: "![shot](/a.png)", at: 1 } })).toBeNull();
  });
});

describe("results and typed text", () => {
  it("says what a verb came to without the card itself", () => {
    expect(hostResult("card-1")).toEqual({ ok: true, cardId: "card-1" });
    expect(hostFailure("No.")).toEqual({ ok: false, error: "No." });
    expect(isHostDone({ cardId: "card-1", result: hostResult("card-1") })).toBe(true);
    expect(isHostDone("card-1")).toBe(false);
    expect(isHostDone(null)).toBe(false);
  });

  it("names the arg a person typed, for the verbs that have one", () => {
    expect(textArgOf("card.message")).toBe("text");
    expect(textArgOf("card.message.edit")).toBe("text");
    expect(textArgOf("card.fresh")).toBe("message");
    expect(textArgOf("card.schedule")).toBe("text");
    expect(textArgOf("card.stop")).toBeUndefined();
  });

  it("adds a read verb's answer to the result, fitted to the column, and nothing for the rest", () => {
    expect(verbResult("card.stop", "c", { ok: true })).toEqual({ ok: true, cardId: "c" });
    expect(verbResult("skills.list", "c", { skills: [{ name: "ship", description: "Ship it", source: "project" }] })).toEqual({
      ok: true,
      cardId: "c",
      skills: [["ship", "Ship it", "project"]],
    });
    expect(verbResult("skills.list", "c", undefined)).toEqual({ ok: true, cardId: "c", skills: [] });
  });

  it("carries dev.open's private address, capped, and nothing when there's none", () => {
    expect(verbResult("dev.open", "c", { address: "https://weft.zip/t/t1" })).toEqual({ ok: true, cardId: "c", address: "https://weft.zip/t/t1" });
    expect((verbResult("dev.open", "c", { address: `https://weft.zip/t/${"a".repeat(900)}` }) as { address: string }).address).toHaveLength(500);
    expect(verbResult("dev.open", "c", undefined)).toEqual({ ok: true, cardId: "c" });
  });
});

describe("remoteRefusal for the editor's verbs", () => {
  it("refuses a read of a credential, a save into an agent's settings, and a call that names no file", () => {
    expect(remoteRefusal({ verb: "files.read", args: { id: "c1", path: ".ssh/id_rsa" } })).toContain("holds credentials");
    expect(remoteRefusal({ verb: "files.write", args: { id: "c1", path: ".codex/config.toml", text: "x" } })).toContain(".codex");
    expect(remoteRefusal({ verb: "files.write", args: { id: "c1", text: "x" } })).toBe("That names no file.");
    expect(remoteRefusal({ verb: "files.read", args: { id: "c1", path: "src/a.ts" } })).toBeNull();
    expect(remoteRefusal({ verb: "files.list", args: { id: "c1" } })).toBeNull();
  });
});
