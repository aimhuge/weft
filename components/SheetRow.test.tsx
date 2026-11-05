// @vitest-environment jsdom
// The sheet's row: the numbered gutter and the row's content beside it.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SheetRow from "./SheetRow";
import "./test-utils";

describe("SheetRow", () => {
  it("draws the gutter and the content side by side", () => {
    const view = render(
      <SheetRow gutter="7">
        <span>the row</span>
      </SheetRow>,
    );
    const row = view.container.querySelector(".sheet-row") as HTMLElement;
    expect(row).toBeInTheDocument();
    expect(row).toHaveClass("flex");
    expect(view.getByText("7")).toBeInTheDocument();
    expect(view.getByText("the row")).toBeInTheDocument();
    expect(row.querySelector(".sheet-gutter")).toBeInTheDocument();
    expect(row.querySelector(".min-w-0.flex-1")).toBeInTheDocument();
  });

  it("leaves the gutter empty when it numbers nothing", () => {
    const view = render(<SheetRow>the row</SheetRow>);
    expect(view.container.querySelector(".sheet-gutter")?.textContent).toBe("");
  });

  it("takes extra class names on the row and on the gutter", () => {
    const view = render(
      <SheetRow className="sheet-row-nested" gutterClassName="text-cron" gutter="⏰">
        the row
      </SheetRow>,
    );
    const row = view.container.querySelector(".sheet-row") as HTMLElement;
    expect(row).toHaveClass("sheet-row-nested");
    expect(row.querySelector(".sheet-gutter")).toHaveClass("text-cron");
  });

  it("passes the row's own props through, for a row that drags", () => {
    const view = render(
      <SheetRow data-card-id="c1" draggable>
        the row
      </SheetRow>,
    );
    const row = view.container.querySelector(".sheet-row") as HTMLElement;
    expect(row).toHaveAttribute("data-card-id", "c1");
    expect(row).toHaveAttribute("draggable", "true");
  });
});
