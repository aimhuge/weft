// The list view's grid: the columns of the sheet, and the widths they hold. The header row and the
// card rows share this template, so a column's header always sits over its cells.
//
// The template itself lives in list-grid.css, because it needs minmax() and Tailwind drops an
// arbitrary value holding a comma.
import "./list-grid.css";

export const LIST_GRID = "list-grid";
