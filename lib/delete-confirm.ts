// Whether deleting a card asks first. The flag lives in localStorage, like the "don't ask again"
// on the Switch all dialog (components/switch-all-button.tsx): it's a per-user, per-machine
// preference, not a board setting, and it has to survive a reload without a round trip.
//
// A native confirm (window.confirm) can't show a checkbox, so the delete dialog is Weft's own
// modal (components/DeleteCardDialog.tsx). Ticking "Don't ask again" writes this flag, and the
// next delete goes straight through.
const SKIP_KEY = "weft.delete.skipConfirm";

// Whether to ask before deleting. On unless the user said not to.
export function shouldConfirmDelete(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(SKIP_KEY) !== "1";
}

// Remember the tick. `skip` true means "don't ask again"; false clears it, so a card deleted
// with the box ticked can be asked about again.
export function rememberDeleteConfirm(skip: boolean) {
  if (typeof localStorage === "undefined") return;
  if (skip) localStorage.setItem(SKIP_KEY, "1");
  else localStorage.removeItem(SKIP_KEY);
}
