import { describe, expect, it } from "vitest";
import { answerPasted } from "./answer-pasted";

// An image pasted into a question's answer box couldn't be opened by the card that asked (2026-11-16).

const img = (name: string) => `![pasted-image.png](/Users/me/.weft/attachments/${name})`;

describe("answerPasted", () => {
  it("finds the attachments the user pasted into answers, notes and a chat decline, once each", () => {
    const qs = [{ question: "Which?", options: [{ label: "A" }] }];
    const answers = { "Which?": `here ${img("pasted-image-11111111.webp")}`, "Other?": img("pasted-image-11111111.webp") };
    const reply = { annotations: { "Which?": { notes: img("shot-22222222.png") }, "Other?": {} }, chat: img("clip-33333333.mp4") };
    expect(answerPasted(qs, answers, reply)).toEqual(["pasted-image-11111111.webp", "shot-22222222.png", "clip-33333333.mp4"]);
  });

  it("leaves out what the question's own options name and files outside an attachments folder", () => {
    const qs = [{ question: "Which?", options: [{ label: img("other-card-44444444.png") }, { label: "B", description: img("desc-55555555.png") }] }];
    const answers = { "Which?": `${img("other-card-44444444.png")}, ${img("desc-55555555.png")} ![f](/tmp/f.png)` };
    expect(answerPasted(qs, answers)).toEqual([]);
    expect(answerPasted(undefined)).toEqual([]);
  });
});
