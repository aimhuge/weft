import { describe, expect, it } from "vitest";
import { INTERVIEW_QUESTIONS, interviewEmoji, interviewName, interviewSoul, interviewTagline } from "./agent-interview";

describe("agent-interview", () => {
  it("asks about the job, the edges and the name", () => {
    expect(INTERVIEW_QUESTIONS.map((q) => q.key)).toEqual(["checks", "refuses", "shows", "stops", "name"]);
    // Every question but the name offers choices; the name is the user's own.
    for (const q of INTERVIEW_QUESTIONS.slice(0, 4)) expect(q.options?.length).toBeGreaterThan(0);
    expect(INTERVIEW_QUESTIONS.at(-1)?.options).toBeUndefined();
  });

  it("names the agent after the user, or after the job", () => {
    expect(interviewName({ checks: "reproduce", name: "Triage" })).toBe("Triage");
    expect(interviewName({ checks: "reproduce" })).toBe("Reproducer");
    expect(interviewName({ checks: "scope" })).toBe("Validator");
    expect(interviewName({ checks: "scope", name: "  " })).toBe("Validator");
    expect(interviewName({ checks: "reproduce", name: "x".repeat(60) })).toHaveLength(40);
  });

  it("gives it one line and one emoji", () => {
    expect(interviewTagline({ checks: "causes" })).toBe("Checks the cause is understood before the work starts");
    expect(interviewTagline({})).toBe("Checks whether the issue is worth working on before the work starts");
    expect(interviewEmoji({ checks: "reproduce" })).toBe("🔍");
    expect(interviewEmoji({ checks: "scope" })).toBe("🛡️");
  });

  it("writes a soul as instructions, not a description", () => {
    const soul = interviewSoul({ checks: "reproduce", refuses: "no-write", shows: "verdict", stops: "always-when-unsure", name: "Triage" });
    // It tells the thread what to do, in order.
    expect(soul).toContain("You are the Triage");
    expect(soul).toContain("1. The issue:");
    expect(soul).toContain("3. The reproduction:");
    expect(soul).toContain("A clear verdict: work it, or don't");
    // The refusal it was given, as a line it must not cross.
    expect(soul).toContain("- Change any file. You read and report; someone else writes.");
    // And when it stops.
    expect(soul).toContain("You stop and ask");
  });

  it("falls back to sensible defaults when the answers are thin", () => {
    const soul = interviewSoul({});
    expect(soul).toContain("You are the Validator");
    expect(soul).toContain("3. The gap between what the issue says and what the code does");
    expect(soul).toContain("- One line: work it, or don't.");
    expect(soul).toContain("- Guess. If the issue does not say enough, you say so and stop.");
    expect(soul).toContain("You stop and ask");
  });

  it("writes the 'never stop' line when the user says it decides alone", () => {
    expect(interviewSoul({ stops: "never" })).toContain("You decide, and you say plainly what you assumed.");
    expect(interviewSoul({ stops: "before-write" })).toContain("You report what you found and stop before you change anything.");
  });

  it("keeps every soul a list of lines, not one paragraph", () => {
    const soul = interviewSoul({ checks: "safe", refuses: "no-network", shows: "diff" });
    expect(soul.split("\n").length).toBeGreaterThan(15);
    expect(soul).toContain("3. The blast radius:");
    expect(soul).toContain("- Call out to the network.");
    expect(soul).toContain("- The change you would make, as a diff");
  });
});
