import { describe, expect, it } from "vitest";
import { answerBody, answerCommand, answerGrant, commandText, isOpenCommand, newCardBody, newCardCommand, replyBody, replyCommand, stopBody, stopCommand, type CloudCommandRow } from "./cloud-commands";
import { CODEX_DEFAULT_MODEL } from "./new-thread";

const target = { orgId: "o1", device: "mac-1", folder: "/dev/app" };

describe("newCardCommand", () => {
  it("is nothing to run without a prompt", () => {
    expect(newCardCommand(target, { prompt: "  \n " })).toBeNull();
  });

  it("addresses the folder on the device, with just the prompt by default", () => {
    expect(newCardCommand(target, { prompt: "  Add dark mode " })).toEqual({
      org_id: "o1",
      kind: "new_card",
      target_device: "mac-1",
      folder: "/dev/app",
      payload: { prompt: "Add dark mode" },
    });
  });

  it("carries the model with the CLI that serves it, and the effort", () => {
    expect(newCardCommand(target, { prompt: "x", model: "claude-opus-5-5", effort: "high" })?.payload).toEqual({
      prompt: "x",
      backend: "claude",
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(newCardCommand(target, { prompt: "x", model: "opus-4.8" })?.payload).toMatchObject({ backend: "puku", model: "opus-4.8" });
    expect(newCardCommand(target, { prompt: "x", model: CODEX_DEFAULT_MODEL })?.payload).toMatchObject({ backend: "codex", model: CODEX_DEFAULT_MODEL });
  });

  it("leaves out a model no CLI serves and an empty pick", () => {
    expect(newCardCommand(target, { prompt: "x", model: "gpt-9", effort: "" })?.payload).toEqual({ prompt: "x" });
    expect(newCardCommand(target, { prompt: "x", model: "" })?.payload).toEqual({ prompt: "x" });
  });
});

describe("newCardBody", () => {
  it("is the request body of POST /api/cards, in the command's folder", () => {
    expect(newCardBody({ folder: "/dev/app", payload: { prompt: "p", title: "t", backend: "puku", model: "opus-4.8", effort: "low", tags: ["a", "b"] } })).toEqual({
      prompt: "p",
      title: "t",
      backend: "puku",
      model: "opus-4.8",
      effort: "low",
      tags: ["a", "b"],
      cwd: "/dev/app",
    });
  });

  it("carries over only what a card is made from, as the types it must be", () => {
    const payload = { prompt: 4, tags: ["a", 7], permissionMode: "bypassPermissions", cwd: "/etc", start: false } as never;
    const body = newCardBody({ folder: "/dev/app", payload });
    expect(body).toEqual({ prompt: undefined, title: undefined, backend: undefined, model: undefined, effort: undefined, tags: ["a"], cwd: "/dev/app" });
    expect(Object.keys(body)).not.toContain("permissionMode");
  });

  it("copes with a payload that isn't an object", () => {
    expect(newCardBody({ folder: "/dev/app", payload: null as never })).toMatchObject({ prompt: undefined, tags: undefined, cwd: "/dev/app" });
  });
});

describe("isOpenCommand", () => {
  it("is true until the Mac has finished with it", () => {
    const at = (status: CloudCommandRow["status"]) => isOpenCommand({ status });
    expect([at("pending"), at("claimed"), at("done"), at("failed")]).toEqual([true, true, false, false]);
  });
});

describe("replyCommand", () => {
  const to = { ...target, cardId: "c1" };

  it("is nothing to send for an empty reply", () => {
    expect(replyCommand(to, "  \n ")).toBeNull();
  });

  it("addresses the card's Mac and folder, with the card and the trimmed text", () => {
    expect(replyCommand(to, " ship it ")).toEqual({ org_id: "o1", kind: "reply", target_device: "mac-1", folder: "/dev/app", payload: { cardId: "c1", text: "ship it" } });
  });
});

describe("replyBody", () => {
  it("reads the card and the text back", () => {
    expect(replyBody({ payload: { cardId: "c1", text: " hi " } })).toEqual({ cardId: "c1", text: "hi" });
  });

  it("is null when the card or the text is missing or the wrong type", () => {
    expect(replyBody({ payload: { cardId: "c1", text: "  " } })).toBeNull();
    expect(replyBody({ payload: { text: "hi" } as never })).toBeNull();
    expect(replyBody({ payload: { cardId: 4, text: "hi" } as never })).toBeNull();
    expect(replyBody({ payload: null as never })).toBeNull();
  });
});

describe("commandText", () => {
  it("is a new card's prompt or a reply's text", () => {
    expect(commandText({ kind: "new_card", payload: { prompt: "Add dark mode" } })).toBe("Add dark mode");
    expect(commandText({ kind: "reply", payload: { cardId: "c1", text: "go" } })).toBe("go");
    expect(commandText({ kind: "new_card", payload: {} as never })).toBe("");
  });
});

describe("folder grants on an answer", () => {
  const to = { orgId: "o", device: "d", folder: "f", cardId: "c" };
  const body = (payload: unknown) => answerBody({ payload } as never);
  const prompt = { id: "p1", toolName: "Read", title: "t", input: {}, readScope: { directory: "/w/data", token: "~/data" } };

  it("carries the scope on an Allow and never on a Deny", () => {
    expect(answerCommand(to, { pendingId: "p1", allow: true, grant: "always" })?.payload).toEqual({ cardId: "c", pendingId: "p1", allow: true, grant: "always" });
    expect(answerCommand(to, { pendingId: "p1", allow: false, grant: "always" })?.payload).toEqual({ cardId: "c", pendingId: "p1", allow: false });
  });

  it("reads back only a known scope, on an Allow, and never a path", () => {
    expect(body({ cardId: "c", pendingId: "p1", allow: true, grant: "card", directory: "/" })).toEqual({ cardId: "c", pendingId: "p1", allow: true, grant: "card" });
    expect(body({ cardId: "c", pendingId: "p1", allow: true, grant: "everything" })?.grant).toBeUndefined();
    expect(body({ cardId: "c", pendingId: "p1", allow: false, grant: "always" })?.grant).toBeUndefined();
  });

  const answer = { cardId: "c", pendingId: "p1", allow: true, grant: "card" as const };

  it("takes the folder from the waiting request", () => {
    expect(answerGrant(answer, prompt)).toEqual({ directory: "/w/data", scope: "card" });
    expect(answerGrant({ ...answer, grant: undefined }, prompt)).toBeNull();
  });

  it("refuses a request that isn't the one answered", () => {
    expect(() => answerGrant(answer, null)).toThrow("isn't waiting");
    expect(() => answerGrant(answer, { ...prompt, id: "p2" })).toThrow("isn't waiting");
  });

  it("refuses a question, a form, and a prompt with no folder", () => {
    expect(() => answerGrant(answer, { ...prompt, questions: [] })).toThrow("no folder");
    expect(() => answerGrant(answer, { ...prompt, elicitation: { message: "m", fields: [] } } as never)).toThrow("no folder");
    expect(() => answerGrant(answer, { ...prompt, readScope: undefined })).toThrow("no folder");
  });
});

describe("answerCommand", () => {
  const to = { ...target, cardId: "c1" };

  it("is nothing to send without a pendingId", () => {
    expect(answerCommand(to, { pendingId: "", allow: true })).toBeNull();
  });

  it("addresses the card's Mac and folder, with the card, the request, the allow and the answers", () => {
    expect(answerCommand(to, { pendingId: "p1", allow: true, answers: { q: "a" } })).toEqual({
      org_id: "o1",
      kind: "answer",
      target_device: "mac-1",
      folder: "/dev/app",
      payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" } },
    });
  });

  it("carries the question reply (notes, Chat about this) when given", () => {
    expect(
      answerCommand(to, { pendingId: "p1", allow: true, answers: { q: "a" }, reply: { annotations: { q: { notes: "n" } }, chat: "talk" } })?.payload,
    ).toMatchObject({ allow: true, answers: { q: "a" }, reply: { annotations: { q: { notes: "n" } }, chat: "talk" } });
  });
});

describe("answerBody", () => {
  it("reads the card, pendingId, allow and answers back, normalizing anything but true to false", () => {
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" } } })).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
      answers: { q: "a" },
    });
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: "yes", answers: { q: "a" } } as never })).toMatchObject({ allow: false });
  });

  it("drops non-string answer values, drops empty answers, and threads a question reply through readQuestionReply", () => {
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a", r: 7, s: null } } as never })).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
      answers: { q: "a" },
    });
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: 7 } } as never })).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
    });
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: "nope" } as never })).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
    });
    expect(answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: [] } as never })).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
    });
    expect(
      answerBody({ payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" }, reply: { annotations: { q: { notes: "n", preview: "p" } }, chat: "talk" } } }),
    ).toEqual({
      cardId: "c1",
      pendingId: "p1",
      allow: true,
      answers: { q: "a" },
      reply: { annotations: { q: { notes: "n", preview: "p" } }, chat: "talk" },
    });
  });

  it("is null when the card or the pendingId is missing or the wrong type, or the payload isn't an object", () => {
    expect(answerBody({ payload: { pendingId: "p1", allow: true } as never })).toBeNull();
    expect(answerBody({ payload: { cardId: "c1", allow: true } })).toBeNull();
    expect(answerBody({ payload: { cardId: 4, pendingId: "p1", allow: true } as never })).toBeNull();
    expect(answerBody({ payload: { cardId: "c1", pendingId: 4, allow: true } as never })).toBeNull();
    expect(answerBody({ payload: null as never })).toBeNull();
  });
});

describe("stopCommand", () => {
  it("addresses the card's Mac and folder with just the card", () => {
    expect(stopCommand({ ...target, cardId: "c1" })).toEqual({
      org_id: "o1",
      kind: "stop",
      target_device: "mac-1",
      folder: "/dev/app",
      payload: { cardId: "c1" },
    });
  });
});

describe("stopBody", () => {
  it("reads the card back", () => {
    expect(stopBody({ payload: { cardId: "c1" } })).toEqual({ cardId: "c1" });
  });

  it("is null when the card is missing or the wrong type, or the payload isn't an object", () => {
    expect(stopBody({ payload: {} as never })).toBeNull();
    expect(stopBody({ payload: { cardId: 4 } as never })).toBeNull();
    expect(stopBody({ payload: null as never })).toBeNull();
  });
});

describe("commandText (answer + stop)", () => {
  it("joins an answer's answers, or says Allowed/Denied when there are none, and says Stop for a stop", () => {
    expect(commandText({ kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "Yes", r: "No" } } })).toBe("Yes; No");
    expect(commandText({ kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: true, answers: {} } })).toBe("Allowed");
    expect(commandText({ kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: false } })).toBe("Denied");
    expect(commandText({ kind: "stop", payload: { cardId: "c1" } })).toBe("Stop");
  });
});
