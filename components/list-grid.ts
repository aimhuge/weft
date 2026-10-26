// The list view's grid: @aimhuge/sheet's grid (its sheet.css, imported in app/globals.css) with the board's columns, and the widths
// they hold. The header row and the card rows share it, so a column's header always sits over its cells.
//
// The widths live in list-grid.css, because they need minmax() and Tailwind drops an arbitrary value holding a comma.
import "./list-grid.css";

export const LIST_GRID = "list-grid sheet-grid";
