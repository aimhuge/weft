// @vitest-environment jsdom
// The drop-onto-card gesture in BoardColumn. The column wraps each rendered card in a
// CardDropSlot when an onReorder prop is given. The slot listens for drag events with a
// text/plain payload, shows a top/bottom indicator on hover, and fires onReorder(id, before)
// on drop. Heavy dependencies (ColumnHeader, ColumnPlaceholder, the icon set) are stubbed
// so the test only exercises the drop wiring.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

vi.mock("./ColumnHeader", () => ({ default: () => <div data-testid="header" /> }));
vi.mock("./ColumnPlaceholder", () => ({ default: () => <div data-testid="placeholder" /> }));
vi.mock("./BacklogActions", () => ({ default: () => null }));

import BoardColumn from "./BoardColumn";

afterEach(cleanup);

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "t", column: "backlog", backend: "claude", permissionMode: "default", cwd: "/r", createdAt: 0, updatedAt: 0, ...over }) as Card;

// renderCard just gives the card a data-card-id so the drop slot can find it.
const renderStub = (c: Card) => <div data-card-id={c.id}>{c.title}</div>;

function setup(cards: Card[], onReorder?: (id: string, target: string, before: boolean) => void, wide?: boolean) {
  return render(
    <BoardColumn
      column={{ id: "backlog", label: "Backlog" }}
      shown={cards}
      count={cards.length}
      loaded
      filtering={false}
      dragOver={false}
      laneState="hidden"
      onShowMore={() => {}}
      renderCard={renderStub}
      onDragOver={() => {}}
      onDragLeave={() => {}}
      onDrop={() => {}}
      onColumnContextMenu={() => {}}
      onReorder={onReorder}
      needsYou={false}
      archivedCount={0}
      showArchived={false}
      onToggleArchived={() => {}}
      toArchive={0}
      archiveTip=""
      onArchiveAll={() => {}}
      onAddBacklog={() => {}}
      wide={wide}
    />,
  );
}

describe("BoardColumn width", () => {
  it("lays a wide column's cards out in two columns, in order", () => {
    const { container } = setup([card({ id: "a" }), card({ id: "b" }), card({ id: "c" })], vi.fn(), true);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toContain("w-[540px]");
    const grid = section.querySelector(".grid-cols-2") as HTMLElement;
    expect([...grid.querySelectorAll("[data-card-id]")].map((el) => el.getAttribute("data-card-id"))).toEqual(["a", "b", "c"]);
  });

  it("keeps a narrow column's cards in one", () => {
    const { container } = setup([card({ id: "a" })]);
    expect((container.querySelector("section") as HTMLElement).className).toContain("w-[264px]");
    expect(container.querySelector(".grid-cols-2")).toBeNull();
  });
});

describe("BoardColumn drop-onto-card (backlog)", () => {
  it("shows no drop slot when onReorder is not given", () => {
    setup([card({ id: "a" })]);
    expect(document.querySelector("[data-drop-slot]")).toBeNull();
  });

  it("fires onReorder with the moved card, the target card, and a top/bottom direction on drop", () => {
    const onReorder = vi.fn();
    setup([card({ id: "a" }), card({ id: "b" })], onReorder);
    const slots = document.querySelectorAll("[data-drop-slot]");
    expect(slots).toHaveLength(2);
    // Drop "a" on the second card "b". The slot fires onReorder with the moved id, the
    // target's id, and a before flag; we don't assert the exact before value because
    // jsdom's getBoundingClientRect returns zeros and the column's click half decides
    // the direction.
    const dt = { types: ["text/plain"], getData: () => "a" } as unknown as DataTransfer;
    fireEvent.drop(slots[1] as HTMLElement, { dataTransfer: dt, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onReorder).toHaveBeenCalledTimes(1);
    const call = onReorder.mock.calls[0] as [string, string, boolean];
    expect(call[0]).toBe("a");
    expect(call[1]).toBe("b");
    expect(typeof call[2]).toBe("boolean");
  });

  it("ignores a drop onto the same card the user picked up", () => {
    const onReorder = vi.fn();
    setup([card({ id: "a" })], onReorder);
    const slot = document.querySelector("[data-drop-slot]") as HTMLElement;
    const dt = { types: ["text/plain"], getData: () => "a" } as unknown as DataTransfer;
    fireEvent.drop(slot, { dataTransfer: dt, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores a drop whose payload isn't a text/plain card id", () => {
    const onReorder = vi.fn();
    setup([card({ id: "a" }), card({ id: "b" })], onReorder);
    const slot = document.querySelectorAll("[data-drop-slot]")[1] as HTMLElement;
    const dt = { types: ["Files"], getData: () => "" } as unknown as DataTransfer;
    fireEvent.drop(slot, { dataTransfer: dt, clientY: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("shows a drop indicator when the cursor drags over a card", () => {
    setup([card({ id: "a" }), card({ id: "b" })], () => {});
    const slot = document.querySelectorAll("[data-drop-slot]")[0] as HTMLElement;
    const dt = { types: ["text/plain"], getData: () => "b" } as unknown as DataTransfer;
    fireEvent.dragOver(slot, { dataTransfer: dt, clientY: 10 });
    // The indicator is a 1px-tall div with the accent class, at either top-0 or bottom-0.
    const indicator = slot.querySelector(".bg-accent");
    expect(indicator).not.toBeNull();
    expect(indicator?.className).toMatch(/\b(top-0|bottom-0)\b/);
  });
});
