import { describe, expect, it } from "vitest";
import { NEW_CARD_FIELDS } from "./new-card-form";

// The phone app (~/dev/weft-mobile) and weft.zip's phone layout draw their chips in this order, as the desktop draws its
// pickers: a change here is a change on every client, so it is pinned.
describe("NEW_CARD_FIELDS", () => {
  it("lists the pickers in the desktop dialog's order", () => {
    expect(NEW_CARD_FIELDS).toEqual(["where", "isolate", "agent", "model", "effort", "mode", "tags"]);
  });
});
