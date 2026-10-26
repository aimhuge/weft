import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../runner-state";

// What an ask becomes on every CLI: a one-shot retry grant or a granted folder lets the call through, otherwise the
// card asks you in the guard's own words (the folder gate's, a symbol claim's, or the guard's title).

const takeGrant = vi.fn<(...a: unknown[]) => unknown>();
const grantedRead = vi.fn<(...a: unknown[]) => unknown>();
const folderAsk = vi.fn<(...a: unknown[]) => unknown>();
const claimQuestion = vi.fn<(...a: unknown[]) => unknown>();
const askUser = vi.fn<(...a: unknown[]) => unknown>();
vi.mock("../classifier-denial", () => ({ takeGrant: (...a: unknown[]) => takeGrant(...a) }));
vi.mock("../folder-guard", () => ({ grantedRead: (...a: unknown[]) => grantedRead(...a), folderAsk: (...a: unknown[]) => folderAsk(...a) }));
vi.mock("../claim-guard", () => ({ claimQuestion: (...a: unknown[]) => claimQuestion(...a), claimSymbols: () => ["Login"], claimWhy: () => "claim why" }));
vi.mock("../runner-ask", () => ({ askUser: (...a: unknown[]) => askUser(...a) }));

const { askAboutCall } = await import("./ask");

const session = { cardId: "c", spec: { cwd: "/w" } } as unknown as Session;
const signal = new AbortController().signal;
const input = { file_path: "/elsewhere/a" };

beforeEach(() => {
  for (const f of [takeGrant, grantedRead, folderAsk, claimQuestion, askUser]) f.mockReset();
  askUser.mockResolvedValue({ behavior: "allow", updatedInput: input });
});

describe("askAboutCall", () => {
  it("refuses a call from a thread with no card, since nobody could answer", async () => {
    expect(await askAboutCall({ ...session, cardId: null }, "Read", input, "t", signal)).toEqual({ behavior: "deny", message: "No card is attached yet." });
  });

  it("lets through a call you allowed once after auto mode blocked it", async () => {
    takeGrant.mockReturnValue(true);
    expect(await askAboutCall(session, "Read", input, "t", signal)).toEqual({ behavior: "allow", updatedInput: input });
    expect(askUser).not.toHaveBeenCalled();
  });

  it("lets through a read inside a folder you granted", async () => {
    grantedRead.mockReturnValue(true);
    expect(await askAboutCall(session, "Read", input, "t", signal)).toEqual({ behavior: "allow", updatedInput: input });
    expect(grantedRead).toHaveBeenCalledWith("Read", input, "/w", "c");
  });

  it("asks in the folder gate's words when the call leaves the folder", async () => {
    folderAsk.mockReturnValue({ question: "Read /elsewhere?", why: "outside", folder: "/elsewhere" });
    await askAboutCall(session, "Read", input, "t", signal, "title");
    expect(askUser).toHaveBeenCalledWith("c", session, "Read", input, signal, "Read /elsewhere?", { symbols: ["Login"], why: "outside", folder: "/elsewhere" });
  });

  it("asks in a symbol claim's words, else the guard's title", async () => {
    claimQuestion.mockReturnValueOnce("Card X holds Login. Go ahead?");
    await askAboutCall(session, "Edit", input, "t", signal, "title");
    expect(askUser.mock.calls[0]?.slice(5)).toEqual(["Card X holds Login. Go ahead?", { symbols: ["Login"], why: "claim why", folder: undefined }]);
    await askAboutCall(session, "Edit", input, "t", signal, "title");
    expect(askUser.mock.calls[1]?.[5]).toBe("title");
  });
});
