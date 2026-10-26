// Driving a model picker (components/ModelTypeahead.tsx) from a component test, the way a user does:
// focus the field to open its list, then click a row. The field shows the picked row's label, not its
// model id, so a test reads the label back with toHaveValue("Opus 5.5").
import { fireEvent, screen, within } from "@testing-library/react";

type Scope = Pick<typeof screen, "getByRole">;

// A row's accessible name is its label plus the id and note beside it ("Let Claude Code choose Runs
// Fable 5.1"), so a row is found by the label it starts with.
export function rowName(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

/** Opens the picker named `name` and returns its list. */
export function openModels(name: string, scope: Scope = screen): HTMLElement {
  fireEvent.focus(scope.getByRole("combobox", { name }));
  return screen.getByRole("listbox", { name });
}

/** Opens the picker named `name` and picks the row whose label is `label`. */
export function pickModel(name: string, label: string, scope: Scope = screen): void {
  fireEvent.click(within(openModels(name, scope)).getByRole("option", { name: rowName(label) }));
}
