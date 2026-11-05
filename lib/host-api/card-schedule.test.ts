// Send later and the "/" list as verbs: card.schedule holds a trimmed message on the card for its time,
// card.unschedule takes one back, and skills.list reads the skills of the card's own folder on this host.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("@/lib/store", () => ({ getCard: vi.fn((id: string) => db.cards.get(id)) }));
vi.mock("@/lib/scheduler", () => ({
  scheduleMessage: vi.fn((id: string) => db.cards.get(id)),
  unscheduleMessage: vi.fn((id: string) => db.cards.get(id)),
}));
vi.mock("@/lib/skills", () => ({ listSkills: vi.fn(() => [{ name: "ship", description: "d", source: "project" }]) }));

const scheduler = await import("@/lib/scheduler");
const skills = await import("@/lib/skills");
const { scheduleVerb, unscheduleVerb } = await import("./card-schedule");
const { skillsListVerb } = await import("./skills-list");
const { NotFound } = await import("./types");

beforeEach(() => {
  db.cards.clear();
  db.cards.set("c1", { id: "c1", cwd: "/work/repo" } as Card);
  vi.clearAllMocks();
});

describe("card.schedule", () => {
  it("holds the trimmed text for the time given, a string time read as a number", async () => {
    await expect(scheduleVerb({ id: "c1", text: "  ship it ", at: "7000" })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(scheduler.scheduleMessage).toHaveBeenCalledWith("c1", "ship it", 7000);
  });

  it("refuses a blank message before the scheduler sees it", async () => {
    await expect(scheduleVerb({ id: "c1", text: "  ", at: 1 })).rejects.toThrow("Write a message first.");
    await expect(scheduleVerb({ id: "c1", at: 1 })).rejects.toThrow("Write a message first.");
    expect(scheduler.scheduleMessage).not.toHaveBeenCalled();
  });

  it("passes the scheduler's refusal on as a rejection", async () => {
    vi.mocked(scheduler.scheduleMessage).mockImplementationOnce(() => {
      throw new Error("That time has already passed.");
    });
    await expect(scheduleVerb({ id: "c1", text: "hi", at: 1 })).rejects.toThrow("That time has already passed.");
  });
});

describe("card.unschedule", () => {
  it("takes the named message back", async () => {
    await expect(unscheduleVerb({ id: "c1", messageId: "m1" })).resolves.toEqual({ card: db.cards.get("c1") });
    expect(scheduler.unscheduleMessage).toHaveBeenCalledWith("c1", "m1");
  });

  it("asks which message when none is named", async () => {
    await expect(unscheduleVerb({ id: "c1" })).rejects.toThrow("Which message?");
    expect(scheduler.unscheduleMessage).not.toHaveBeenCalled();
  });
});

describe("skills.list", () => {
  it("lists the skills of the card's own folder", async () => {
    await expect(skillsListVerb({ id: "c1" })).resolves.toEqual({ skills: [{ name: "ship", description: "d", source: "project" }] });
    expect(skills.listSkills).toHaveBeenCalledWith("/work/repo");
  });

  it("is a 404 for a card this host doesn't have", async () => {
    await expect(skillsListVerb({ id: "nope" })).rejects.toBeInstanceOf(NotFound);
    expect(skills.listSkills).not.toHaveBeenCalled();
  });
});
