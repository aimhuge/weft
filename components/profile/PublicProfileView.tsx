// The body of weft.zip/@username (app/u/[username]/page.tsx): everything the Loom's Wefter Profile shows that
// may be public. The hero (picture in its level ring, class, bio, GitHub facts, league), the big numbers,
// the builder card, the activity cloth, badges, tokens and records come from the card the account's Mac last
// posted (lib/profile-card.ts); mini apps and threads are its public share links. Never projects or folders.
// A server component: nothing on it moves, so it ships no JS.
import Link from "next/link";
import type { PublicProfile } from "@/lib/public-profile";
import { ProfileHero, ProfileNumbers } from "./ProfileHero";
import { AppsSection, BadgeSection, BuilderSection, ClothSection, RecordsSection, ThreadsSection, UsageSection } from "./ProfileSections";
import "@/components/team/team.css";
import "./profile.css";
import "./profile-card.css";

function ago(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function PublicProfileView({ profile }: { profile: PublicProfile }) {
  const card = profile.card;
  return (
    <div className="wz-app wz-profile">
      <header className="wz-profileTop">
        <Link className="wz-profileHome" href="/">
          Weft
        </Link>
        <Link className="wz-pfCta" href="/">
          Build with Weft →
        </Link>
      </header>
      <main className="wz-profileMain">
        <ProfileHero profile={profile} />
        {card ? (
          <>
            <ProfileNumbers card={card} />
            <BuilderSection card={card} />
            <ClothSection card={card} />
            <BadgeSection card={card} />
            <UsageSection card={card} />
            <RecordsSection card={card} />
          </>
        ) : (
          <p className="wz-pfPending">
            @{profile.username} hasn&apos;t published their builder card yet.
          </p>
        )}
        <AppsSection apps={profile.apps} />
        <ThreadsSection threads={profile.threads} />
        {profile.cardAt && <p className="wz-pfSynced">Synced from Weft {ago(profile.cardAt)}.</p>}
      </main>
    </div>
  );
}
