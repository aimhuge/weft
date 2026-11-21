// @vitest-environment jsdom
// weft.zip's board places each card by its row (owner_user, owner_device), marks a teammate's as theirs with the
// desktop's own Card.team, and counts the pickers' options over what's on screen.
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import type { BoardDirectory } from "@/lib/board-directory";
import { makeCard } from "../test-utils";
import { directoryNames, markTeammates, rowPlace, useWebOwnerChoices, useWebOwners } from "./useWebOwners";

const row = (card_id: string, owner_user: string | undefined, owner_device: string) => ({ org_id: "o1", card_id, owner_user, owner_device }) as CloudCardRow;
const rows = new Map([
  ["a", row("a", "me-id", "mac1")],
  ["b", row("b", "u2", "mac2")],
  ["c", row("c", "me-id", "worker:w1")],
  ["d", row("d", "u3", "mac3")],
]);
const directory: BoardDirectory = { people: { u2: { name: "Zulker Nien", avatar: "https://z" } }, machines: { mac1: "m5air", "worker:w1": "m1mini" } };
const cards = [makeCard({ id: "a", cwd: "/p" }), makeCard({ id: "b", cwd: "/p" }), makeCard({ id: "c", cwd: "/q" }), makeCard({ id: "d", cwd: "/q" })];

describe("rowPlace", () => {
  it("is ME for the visitor's own rows (or one with no owner), the account id for a teammate's", () => {
    expect(rowPlace(rows.get("a"), "me-id")).toEqual({ who: "me", on: "mac1" });
    expect(rowPlace(rows.get("b"), "me-id")).toEqual({ who: "u2", on: "mac2" });
    expect(rowPlace(row("x", undefined, "mac9"), "me-id")).toEqual({ who: "me", on: "mac9" });
    expect(rowPlace(undefined, "me-id")).toEqual({ who: "me", on: "" });
  });
});

describe("markTeammates", () => {
  it("marks a teammate's card with their name, picture and Mac, and leaves the visitor's alone", () => {
    const marked = markTeammates(cards, rows, "me-id", directory);
    expect(marked[0]).toBe(cards[0]);
    expect(marked[1]!.team).toEqual({ org: "o1", owner: "u2", name: "Zulker Nien", avatar: "https://z", device: "mac2" });
    expect(marked[3]!.team).toMatchObject({ owner: "u3", name: "A teammate", avatar: null });
  });
});

describe("useWebOwners and useWebOwnerChoices", () => {
  it("places the cards and offers the people and machines of the project on screen", () => {
    const { result } = renderHook(() => {
      const owned = useWebOwners(cards, rows, "me-id", directory);
      return { owned, all: useWebOwnerChoices(owned.cards, owned.placeOf, directory, {}, null), onP: useWebOwnerChoices(owned.cards, owned.placeOf, directory, { who: "me" }, "/p") };
    });
    expect(result.current.owned.placeOf(cards[2]!)).toEqual({ who: "me", on: "worker:w1" });
    expect(result.current.all.people.map((p) => [p.id, p.label, p.count])).toEqual([["me", "You", 2], ["u3", "A teammate", 1], ["u2", "Zulker Nien", 1]]);
    expect(result.current.onP.people.map((p) => p.id)).toEqual(["me", "u2"]);
    expect(result.current.onP.machines.map((m) => [m.id, m.label, m.kind])).toEqual([["mac1", "m5air", "mac"]]);
  });

  it("names people and machines from the directory", () => {
    const names = directoryNames(directory);
    expect(names.person("u2")?.name).toBe("Zulker Nien");
    expect(names.machine("worker:w1")).toBe("m1mini");
    expect(names.machine("nope")).toBeUndefined();
  });
});
