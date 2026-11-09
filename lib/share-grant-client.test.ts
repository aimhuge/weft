import { describe, expect, it } from "vitest";
import { bodyOf, callOf, fetchMock } from "./client-api.harness";
import { grantApi } from "./share-grant-client";

// The board's grant calls: each a thin request to the Mac's routes (lib/share-grant-client.ts).

describe("grantApi", () => {
  it("lists, grants and revokes on the card's grants route", async () => {
    await grantApi.list("c1");
    expect(callOf().url).toBe("/api/cards/c1/share/grants");
    expect(callOf().init?.method).toBe("GET");
    await grantApi.grant("c1", { logins: ["octo"], via: "mention", note: "hi" });
    expect(callOf().init?.method).toBe("POST");
    expect(bodyOf()).toEqual({ logins: ["octo"], via: "mention", note: "hi" });
    await grantApi.revoke("c1", 42);
    expect(callOf().url).toBe("/api/cards/c1/share/grants?github=42");
    expect(callOf().init?.method).toBe("DELETE");
  });

  it("searches by q, suggests by card, and asks nothing in particular with neither", async () => {
    const people = [{ login: "octo", name: null, avatarUrl: null, kind: "github" }];
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ people })));
    expect(await grantApi.people("oct", "c1")).toEqual(people);
    expect(callOf().url).toBe("/api/github/users?q=oct");
    await grantApi.people("", "c1");
    expect(callOf().url).toBe("/api/github/users?card=c1");
    await grantApi.people("");
    expect(callOf().url).toBe("/api/github/users?");
  });
});
