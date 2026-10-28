// A shared vault's recovery key (docs/architecture/teams-vault.md, "Recovery key"): the page where
// the user sees the 24 words that open the vault when every machine is gone.
//
// The words are made in Electron main, behind Touch ID: the vault's key only exists there, so the
// server cannot derive them and this page cannot ask the server for them. What this page does:
//
//   1. It gates with requireTeam — the same gate every team page uses — and reads the vault's label
//      and repo from the server, so the heading names the right vault.
//   2. It hands the client component the vault's server id, and the client asks the desktop (the
//      only place the words can be made) for them.
//   3. The words are shown in a 4×6 grid, "Copy words" puts them on the clipboard for a minute, and
//      the user has to tick "I've saved these words somewhere safe." before the page is done.
//
// A re-show is a fresh key: the old words stop working the moment the new ones exist, and the page
// says so, because "my old words don't work any more" is otherwise a mystery.
//
// The words live in the client component's state and nowhere else. Reloading the page loses them —
// which is the "shown once" rule, not an accident.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireTeam } from "@/lib/teams";
import { RecoveryKey } from "./RecoveryKey";
import { recoveryVault } from "./queries";
import "./recovery.css";

export const metadata: Metadata = {
  title: "Recovery key",
  description: "The words that open a shared vault when every machine is gone.",
};

async function RecoveryPageBody({ orgSlug, vaultId }: { orgSlug: string; vaultId: string }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/team/vaults/${vaultId}/recovery`);
  // The vault has to be this workspace's vault. One from another workspace is a 404, the same as one
  // that doesn't exist: a visitor may not learn that it exists.
  const vault = await recoveryVault(ctx.service, vaultId);
  if (!vault || vault.orgId !== ctx.org.id) notFound();

  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Recovery key</h1>
        <p className="wz-teamSub">
          For <strong>{vault.label}</strong> — {vault.repo}. Twenty-four words that open this vault when every machine is gone.
        </p>
      </header>

      <section className="wz-teamSection">
        <RecoveryKey vaultId={vaultId} label={vault.label} repo={vault.repo} />
      </section>

      <footer className="wz-teamFooter">
        Weft never keeps these words — not in a file, not on the server, not in the event log. They exist in this page and wherever you write them down.
      </footer>
    </div>
  );
}

function RecoveryPageFallback() {
  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader wz-hero wz-heroGarage">
        <h1 className="wz-teamTitle">Recovery key</h1>
        <p className="wz-teamSub">Loading the vault…</p>
      </header>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function RecoveryPageFor({ params }: { params: Promise<{ orgSlug: string; vaultId: string }> }) {
  const { orgSlug, vaultId } = await params;
  return <RecoveryPageBody orgSlug={orgSlug} vaultId={vaultId} />;
}

export default function Page({ params }: { params: Promise<{ orgSlug: string; vaultId: string }> }) {
  return (
    <Suspense fallback={<RecoveryPageFallback />}>
      <RecoveryPageFor params={params} />
    </Suspense>
  );
}
