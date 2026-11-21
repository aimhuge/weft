import { describe, expect, it } from "vitest";
import { HERE, ME, cardPlace, deskNames, machineKind, machineName, matchesPlace, ownerChoices, readOwnerParams, withOwnerParams, type CardPlace, type OwnerNames } from "./board-owners";
import type { Card, TeamMark } from "./types";

const mark = (owner: string, name: string, device: string, avatar?: string): TeamMark => ({ org: "o", owner, name, device, avatar });
const card = (cwd: string, team?: TeamMark, archived?: boolean) => ({ cwd, team, archived }) as Pick<Card, "cwd" | "team" | "archived">;

describe("cardPlace", () => {
  it("puts a teammate's card on their Mac, a worker card on its worker and the rest here", () => {
    expect(cardPlace(card("/r", mark("u2", "Alex Doe", "mac-a")))).toEqual({ who: "u2", on: "mac-a" });
    expect(cardPlace(card("worker://w1/weft"))).toEqual({ who: ME, on: "worker:w1" });
    expect(cardPlace(card("/Users/me/dev/weft"))).toEqual({ who: ME, on: HERE });
  });
});

describe("matchesPlace", () => {
  const place: CardPlace = { who: "u2", on: "mac-a" };
  it("keeps a card unless the filter names someone or somewhere else", () => {
    expect(matchesPlace(place, {})).toBe(true);
    expect(matchesPlace(place, { who: "u2" })).toBe(true);
    expect(matchesPlace(place, { who: "u2", on: "mac-a" })).toBe(true);
    expect(matchesPlace(place, { who: ME })).toBe(false);
    expect(matchesPlace(place, { on: "mac-b" })).toBe(false);
  });
});

describe("machineName and machineKind", () => {
  it("cuts the devices table's default name to the machine's own", () => {
    expect(machineName("Weft on MacBook-Air-3.local")).toBe("MacBook-Air-3");
    expect(machineName("m5air")).toBe("m5air");
    expect(machineName("  ")).toBeUndefined();
    expect(machineName(null)).toBeUndefined();
  });
  it("tells a worker from a Mac by its id", () => {
    expect(machineKind("worker:abc")).toBe("worker");
    expect(machineKind("f2aa1d")).toBe("mac");
  });
});

describe("ownerChoices", () => {
  const alex = mark("u2", "Alex Doe", "mac-a", "https://a/x.png");
  const cards = [
    card("/r"),
    card("/r"),
    card("worker://w1/weft"),
    card("/r", alex),
    card("/r", mark("u3", "Bea", "mac-b")),
    card("/r", alex, true),
  ];
  const names = deskNames(cards, [{ workerId: "w1", worker: "m1mini" }]);

  it("lists you first, then teammates by name, counting their cards on screen", () => {
    const { people } = ownerChoices(cards, cardPlace, names);
    expect(people).toEqual([
      { id: ME, label: "You", count: 3 },
      { id: "u2", label: "Alex Doe", avatar: "https://a/x.png", count: 1 },
      { id: "u3", label: "Bea", avatar: undefined, count: 1 },
    ]);
  });

  it("lists This Mac first, then machines by name, and only the chosen person's", () => {
    expect(ownerChoices(cards, cardPlace, names).machines.map((m) => [m.id, m.label, m.kind, m.count])).toEqual([
      [HERE, "This Mac", "mac", 2],
      ["mac-a", "Alex's Mac", "mac", 1],
      ["mac-b", "Bea's Mac", "mac", 1],
      ["worker:w1", "m1mini", "worker", 1],
    ]);
    expect(ownerChoices(cards, cardPlace, names, "u2").machines.map((m) => m.id)).toEqual(["mac-a"]);
  });

  it("names what it can't look up by its owner or a short id", () => {
    const none: OwnerNames = { person: () => undefined, machine: () => undefined };
    const place = (c: { id: string }) => ({ u: { who: "u9", on: "worker:abcdef123" }, m: { who: ME, on: "abcdef999" }, w: { who: ME, on: "worker:fedcba1" } })[c.id as "u" | "m" | "w"];
    const list = [{ id: "u" }, { id: "m" }, { id: "w" }] as (Pick<Card, "archived"> & { id: string })[];
    const { people, machines } = ownerChoices(list, place, none);
    expect(people.find((p) => p.id === "u9")?.label).toBe("A teammate");
    expect(machines.map((m) => m.label)).toEqual(["A teammate's Worker", "Your Mac abcdef", "Your Worker fedcba"]);
    // A blank name still reads as something.
    const blank: OwnerNames = { person: () => ({ name: " " }), machine: () => undefined };
    expect(ownerChoices([{ id: "u" }] as typeof list, place, blank).machines[0]!.label).toBe(" 's Worker");
  });
});

describe("deskNames", () => {
  it("names teammates from their cards and workers from the worker projects", () => {
    const names = deskNames([card("/r", mark("u2", "Alex", "m"))], [{ workerId: "w1", worker: "m1mini" }]);
    expect(names.person("u2")?.name).toBe("Alex");
    expect(names.person("nobody")).toBeUndefined();
    expect(names.machine("worker:w1")).toBe("m1mini");
    expect(names.machine("m")).toBeUndefined();
  });
});

describe("the URL's ?who=…&on=…", () => {
  it("reads both, dropping empty ones", () => {
    expect(readOwnerParams("?who=me&on=worker:w1&card=c")).toEqual({ who: "me", on: "worker:w1" });
    expect(readOwnerParams("?who=&card=c")).toEqual({ who: undefined, on: undefined });
  });
  it("writes both, keeping the rest of the query", () => {
    expect(withOwnerParams("https://weft.zip/t/board?card=c", { who: "u2" })).toBe("https://weft.zip/t/board?card=c&who=u2");
    expect(withOwnerParams("https://weft.zip/t/board?card=c&who=u2&on=m", {})).toBe("https://weft.zip/t/board?card=c");
  });
});
