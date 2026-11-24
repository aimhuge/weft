// @vitest-environment jsdom
// The person and machine pickers: shown only when there's a choice, picking someone clears the machine, and a filter
// the board no longer has a card for still reads as picked.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OwnerChoices } from "@/lib/board-owners";
import OwnerFilter from "./OwnerFilter";

afterEach(cleanup);

const choices: OwnerChoices = {
  people: [
    { id: "me", label: "You", count: 3 },
    { id: "u2", label: "Zulker Nien", count: 4 },
  ],
  machines: [
    { id: "here", label: "This Mac", kind: "mac", count: 2 },
    { id: "worker:w1", label: "m1mini", kind: "worker", count: 1 },
  ],
};
const who = () => screen.getByLabelText<HTMLSelectElement>("Whose cards");
const where = () => screen.getByLabelText<HTMLSelectElement>("Which machine");

describe("OwnerFilter", () => {
  it("lists everyone and every machine with their counts", () => {
    render(<OwnerFilter choices={choices} filter={{}} onFilter={vi.fn()} />);
    expect([...who().options].map((o) => o.text)).toEqual(["Everyone", "You · 3", "Zulker Nien · 4"]);
    expect([...where().options].map((o) => o.text)).toEqual(["All machines", "💻 This Mac · 2", "☁️ m1mini · 1"]);
  });

  it("picks a person, clearing the machine, and picks a machine, keeping the person", () => {
    const onFilter = vi.fn();
    render(<OwnerFilter choices={choices} filter={{ who: "me", on: "here", tag: "bug" }} onFilter={onFilter} />);
    fireEvent.change(who(), { target: { value: "u2" } });
    expect(onFilter).toHaveBeenLastCalledWith({ who: "u2", on: undefined, tag: "bug" });
    fireEvent.change(where(), { target: { value: "worker:w1" } });
    expect(onFilter).toHaveBeenLastCalledWith({ who: "me", on: "worker:w1", tag: "bug" });
    fireEvent.change(who(), { target: { value: "" } });
    expect(onFilter).toHaveBeenLastCalledWith({ who: undefined, on: undefined, tag: "bug" });
  });

  it("hides a picker with nothing to choose, unless a filter is set, which still shows as picked", () => {
    const one: OwnerChoices = { people: [choices.people[0]!], machines: [choices.machines[0]!] };
    const { rerender } = render(<OwnerFilter choices={one} filter={{}} onFilter={vi.fn()} />);
    expect(screen.queryByLabelText("Whose cards")).toBeNull();
    expect(screen.queryByLabelText("Which machine")).toBeNull();
    rerender(<OwnerFilter choices={one} filter={{ who: "u9", on: "mac9" }} onFilter={vi.fn()} web />);
    expect(who().value).toBe("u9");
    expect(who().selectedOptions[0]!.text).toBe("Nobody here");
    expect(where().selectedOptions[0]!.text).toBe("No cards there");
    expect(who().style.colorScheme).toBe("dark");
  });
});
