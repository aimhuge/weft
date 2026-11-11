import { describe, expect, it } from "vitest";
import { defaultsNote, passkeysSigned } from "./worker-defaults";

describe("defaultsNote", () => {
  it("says nothing when pairing planned no defaults", () => {
    expect(defaultsNote(undefined)).toBe("");
    expect(defaultsNote({})).toBe("");
  });

  it("names who can approve there", () => {
    expect(defaultsNote({ passkeys: { passkeys: 1, phones: 0 } })).toBe("Your passkey can approve there.");
    expect(defaultsNote({ passkeys: { passkeys: 2, phones: 1 } })).toBe("Your 2 passkeys and your phone can approve there.");
    expect(defaultsNote({ passkeys: { phones: 2 } })).toBe("Your 2 phones can approve there.");
  });

  it("says nothing for a set narrowed to none while the prompt was up", () => {
    expect(defaultsNote({ passkeys: { passkeys: 0, phones: 0 } })).toBe("");
  });

  it("says GitHub is on, or waits on this Mac's key", () => {
    expect(defaultsNote({ github: { ok: true } })).toBe("GitHub is on for its cards.");
    expect(defaultsNote({ github: { ok: true, waiting: true } })).toMatch(/once this Mac's key is confirmed/);
  });

  it("says why a default didn't take, after the others", () => {
    expect(defaultsNote({ passkeys: { error: "offline" }, github: { error: "Couldn't reach weft.zip." } })).toBe(
      "Your passkeys can't approve there yet: offline. GitHub isn't on there: Couldn't reach weft.zip.",
    );
    expect(defaultsNote({ passkeys: { passkeys: 1 }, github: { ok: true } })).toBe("Your passkey can approve there. GitHub is on for its cards.");
  });
});

describe("passkeysSigned", () => {
  it("is true only when main signed a set", () => {
    expect(passkeysSigned(undefined)).toBe(false);
    expect(passkeysSigned({ github: { ok: true } })).toBe(false);
    expect(passkeysSigned({ passkeys: { error: "x" } })).toBe(false);
    expect(passkeysSigned({ passkeys: { passkeys: 1 } })).toBe(true);
  });
});
