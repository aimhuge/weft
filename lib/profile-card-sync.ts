import type { SupabaseClient } from "@supabase/supabase-js";
import { recordExplore } from "./explore";
import { gameState } from "./game-server";
import { githubProfile } from "./github-profile";
import { globalSingleton } from "./global-singleton";
import { profileCard, type ProfileCard } from "./profile-card";
import { safeClient, signedIn } from "./signed-in-client";

// Posts the public builder card (lib/profile-card.ts) to profile_cards on the league sync's timer
// (lib/league-sync.ts), while you're signed in. The same card twice in a row isn't posted again.

export interface ProfileCardDeps {
  client?: () => SupabaseClient | null;
  card?: () => Promise<ProfileCard>;
}

const ownCard = async () => profileCard(gameState({}), await githubProfile());

const last = () => globalSingleton("__weftProfileCard", () => ({ json: "" }));

// Returns false when there was nobody to post as or nothing new; a missing table (the migration isn't on
// this Supabase yet) is false too, so it waits quietly for the next tick.
export async function syncProfileCard({ client = safeClient, card = ownCard }: ProfileCardDeps = {}): Promise<boolean> {
  const c = client();
  if (!c || !(await signedIn(c))) return false;
  const next = await card();
  const json = JSON.stringify(next);
  if (json === last().json) return false;
  const { error } = await c.rpc("profile_card_submit", { p_card: next });
  if (error?.code === "PGRST202") return false;
  if (error) throw new Error(error.message);
  last().json = json;
  void recordExplore("profile");
  return true;
}
