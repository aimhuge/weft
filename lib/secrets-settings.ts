"use client";

// Opening Settings → Secrets from elsewhere on the board (the 🔐 drawer's ⚙ and status line, a weft://secrets?share=1
// link): the drawer is for using secrets, the Settings page for managing them (docs/architecture/secrets.md, "The
// drawer and Settings → Secrets"). The board listens for the event and opens Settings (components/use-board-commands.ts).
import { rememberPage } from "./settings-nav";

export const OPEN_SETTINGS_EVENT = "weft:open-settings";

// The vault the page should bring into view, until it has.
let focus: string | null = null;

export function openSecretsSettings(vaultId?: string) {
  rememberPage("secrets");
  focus = vaultId ?? null;
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}

// The page's side: the vault to scroll to, once.
export function takeSecretsFocus(): string | null {
  const id = focus;
  focus = null;
  return id;
}
