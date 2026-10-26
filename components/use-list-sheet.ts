"use client";

// The board's list view's sort, filters, title search and folded bands (lib/list-sheet.ts), on
// @aimhuge/sheet's saved state (useSheetState).
import { EMPTY_SHEET, parseSheetState, type Band, type SheetKey } from "@/lib/list-sheet";
import { useSheetState } from "@aimhuge/sheet/client";

export function useListSheet() {
  return useSheetState<SheetKey, Band>("weft:list-sheet", parseSheetState, EMPTY_SHEET);
}
