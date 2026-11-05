import { beforeEach, describe, expect, it, vi } from "vitest";

const finishSignIn = vi.fn();
vi.mock("./account", () => ({ finishSignIn: (code: string): Promise<unknown> => Promise.resolve().then((): unknown => finishSignIn(code)) }));

import { finishDesktopSignIn } from "./desktop-sign-in";

describe("finishDesktopSignIn", () => {
  beforeEach(() => finishSignIn.mockReset());

  it("shows who signed in", async () => {
    finishSignIn.mockReturnValueOnce({ email: "ada@b.co", name: "Ada" });
    const res = await finishDesktopSignIn({ code: "ok" });
    expect(finishSignIn).toHaveBeenCalledWith("ok");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You&#39;re signed in as ada@b.co.");
  });

  it("falls back to the name, then to no one", async () => {
    finishSignIn.mockReturnValueOnce({ email: null, name: "Ada" }).mockReturnValueOnce({ email: null, name: null });
    expect(await (await finishDesktopSignIn({ code: "a" })).text()).toContain("signed in as Ada.");
    const bare = await (await finishDesktopSignIn({ code: "b" })).text();
    expect(bare).not.toContain("signed in as");
    expect(bare).toContain("You can close this tab");
  });

  it("shows the provider's error without exchanging anything", async () => {
    const described = await finishDesktopSignIn({ error: "access_denied", error_description: "User said no" });
    expect(described.status).toBe(400);
    expect(await described.text()).toContain("User said no");
    expect(await (await finishDesktopSignIn({ error: "access_denied" })).text()).toContain("access_denied");
    expect(finishSignIn).not.toHaveBeenCalled();
  });

  it("shows why the exchange failed, and sends a missing code on as empty", async () => {
    finishSignIn.mockImplementationOnce(() => {
      throw new Error("bad code");
    });
    expect(await (await finishDesktopSignIn({})).text()).toContain("bad code");
    expect(finishSignIn).toHaveBeenCalledWith("");
    finishSignIn.mockImplementationOnce(() => {
      throw "plain"; // eslint-disable-line @typescript-eslint/only-throw-error -- a non-Error throw is the branch under test
    });
    expect(await (await finishDesktopSignIn({ code: "x" })).text()).toContain("plain");
  });
});
