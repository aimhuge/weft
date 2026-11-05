import { describe, expect, it } from "vitest";
import type { CloudCommandRow } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";
import type { Card } from "./types";
import { commandAnswer, dropAnswer, withAnswers, type WebAnswer } from "./web-answers";

const pending = { id: "p1", tool: "Bash", title: "Run ls", input: {} } as unknown as NonNullable<Card["pending"]>;
const row = (card: Partial<Card> = {}, card_id = "c1") => ({ card_id, card: { id: card_id, column: "needs_you", pending, lastLine: "asks", ...card } }) as unknown as CloudCardRow;
const command = (over: Partial<CloudCommandRow> = {}) => ({ id: "a1", kind: "answer", status: "pending", payload: { cardId: "c1", pendingId: "p1", allow: true }, ...over }) as CloudCommandRow;
const allow: WebAnswer = { cardId: "c1", pendingId: "p1", allow: true };

describe("withAnswers", () => {
  it("leaves the rows alone with nothing answered", () => {
    const rows = [row()];
    expect(withAnswers(rows, [], [])).toBe(rows);
  });

  it("draws an answered card without its prompt, back in Running", () => {
    const [shown] = withAnswers([row()], [allow], []);
    expect(shown?.card).toMatchObject({ column: "running", pending: null, lastLine: "Allowed: Run ls" });
  });

  it("says Denied, and keeps a card that isn't in Needs you where it is", () => {
    const [shown] = withAnswers([row({ column: "review" })], [{ ...allow, allow: false }], []);
    expect(shown?.card).toMatchObject({ column: "review", pending: null, lastLine: "Denied: Run ls" });
  });

  it("shows a newer prompt, another card's and a card with none as they are", () => {
    const rows = [row({ pending: { ...pending, id: "p2" } }), row({}, "c2"), row({ pending: null })];
    expect(withAnswers(rows, [allow], [])).toEqual(rows);
  });

  it("brings the prompt back when its command failed, not when another one did", () => {
    expect(withAnswers([row()], [allow], [command({ status: "failed" })])[0]?.card.pending).toBe(pending);
    const others = [command({ status: "failed", payload: { cardId: "c1", pendingId: "p0", allow: true } }), command({ kind: "reply", status: "failed", payload: { cardId: "c1", text: "hi" } }), command()];
    expect(withAnswers([row()], [allow], others)[0]?.card.pending).toBeNull();
  });
});

describe("dropAnswer", () => {
  it("forgets the answer a dropped command carried", () => {
    expect(dropAnswer([allow, { ...allow, cardId: "c2" }], command())).toEqual([{ ...allow, cardId: "c2" }]);
  });

  it("keeps every answer for a command that isn't one, or isn't known", () => {
    const answers = [allow];
    expect(dropAnswer(answers, command({ kind: "reply" }))).toBe(answers);
    expect(dropAnswer(answers, undefined)).toBe(answers);
  });
});

describe("commandAnswer", () => {
  it("reads an answer command's payload and nothing else", () => {
    expect(commandAnswer(command())).toEqual({ cardId: "c1", pendingId: "p1", allow: true });
    expect(commandAnswer(command({ kind: "stop" }))).toBeNull();
  });
});
