import { describe, expect, it, vi } from "vitest";
import { AGENT_REFUSED, signedAgent } from "./create-widen";

const command = (payload: unknown) => ({ payload }) as never;

describe("signedAgent", () => {
  it("lets a new thread through as before when it names no agent", async () => {
    const check = vi.fn();
    for (const p of [{ prompt: "p" }, { prompt: "p", agent: null }, { prompt: "p", agent: "" }, null]) expect(await signedAgent(command(p), "app", check)).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it("checks an agent's approval over the agent, the folder and the prompt", async () => {
    const check = vi.fn(() => Promise.resolve(null));
    expect(await signedAgent(command({ prompt: "go", agent: "builder", widen: { k: 1 } }), "app", check)).toBe("builder");
    expect(check).toHaveBeenCalledWith({ card: "", verb: "card.create", change: { create: { agent: "builder", folder: "app", prompt: "go" } } }, { k: 1 }, AGENT_REFUSED);
    await signedAgent(command({ agent: "b" }), "app", check);
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ change: { create: { agent: "b", folder: "app", prompt: "" } } }), undefined, AGENT_REFUSED);
  });

  it("refuses an agent without a check, a refused one, and one that isn't a name", async () => {
    await expect(signedAgent(command({ agent: "b" }), "app", undefined)).rejects.toThrow(AGENT_REFUSED);
    await expect(signedAgent(command({ agent: "b" }), "app", () => Promise.resolve("stale"))).rejects.toThrow("stale");
    await expect(signedAgent(command({ agent: 3 }), "app", () => Promise.resolve(null))).rejects.toThrow(/isn't a name/);
  });
});
