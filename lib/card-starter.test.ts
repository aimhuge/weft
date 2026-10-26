// The one way to start a card to do one thing (lib/card-starter.ts): make the card, let the caller
// set it up, then start its first turn. The order is the point — the caller's setup runs before the
// turn begins, so a Slack card is posted to its channel before the thread can fail.
import { describe, expect, it, vi } from "vitest";

const newCard = vi.hoisted(() => ({
  createCardFromBody: vi.fn((body: Record<string, unknown>) => ({ id: "card-1", title: "T", cwd: "/dev/app", ...body })),
  startCard: vi.fn(() => ({ started: true })),
}));

vi.mock("./new-card", () => newCard);

const { startFeatureCard } = await import("./card-starter");

describe("startFeatureCard", () => {
  it("makes the card and starts its first turn", async () => {
    const card = await startFeatureCard({ prompt: "fix it", cwd: "/dev/app", backend: "claude", tags: ["theme"] });
    expect(newCard.createCardFromBody).toHaveBeenCalledWith({ prompt: "fix it", cwd: "/dev/app", backend: "claude", tags: ["theme"] });
    expect(newCard.startCard).toHaveBeenCalledWith(card);
    expect(card.id).toBe("card-1");
  });

  it("sets the card up before its turn starts", async () => {
    const order: string[] = [];
    newCard.startCard.mockImplementation(() => {
      order.push("start");
      return { started: true };
    });
    await startFeatureCard({ prompt: "fix it", cwd: "/dev/app" }, (card) => {
      order.push(`setup:${card.id}`);
    });
    expect(order).toEqual(["setup:card-1", "start"]);
  });

  it("takes a body read off the network as it comes", async () => {
    const card = await startFeatureCard({ prompt: "fix it", cwd: "/dev/app", backend: "nonsense" });
    expect(card.backend).toBe("nonsense");
    expect(newCard.startCard).toHaveBeenCalled();
  });
});
