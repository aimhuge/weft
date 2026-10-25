// What Settings → Connectors shows about gog (lib/gog.ts), safe to import from the board.
// client: the OAuth client the account signed in through ("default" unless gog was given --client).
export type GogAccount = { email: string; client: string };
export type GogStatus =
  | { installed: false }
  | {
      installed: true;
      version: string;
      // Weft.app's own copy (toolchain/bin), not one the user installed.
      bundled: boolean;
      // Older than the version Weft ships; --readonly needs a newer gog.
      outdated: boolean;
      // The user chose an OAuth client JSON of their own; new sign-ins go through it.
      ownClient: boolean;
      // This build carries Weft's own Google OAuth client, so signing in needs no setup.
      weftClient: boolean;
      accounts: GogAccount[];
      // The email whose browser sign-in is under way.
      adding: string | null;
      lastError: string | null;
    };
