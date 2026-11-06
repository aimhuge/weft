"use client";

// The Teams page inside the desktop's Settings: "Your teams", every team
// you're in, and below it the one you picked (components/team/TeamPanel.tsx).
// The desktop can't use weft.zip's cookie session or the service key, so
// `useTeam(org?)` from lib/use-team.ts posts TeamOp bodies to
// /api/account/team, which forwards them to weft.zip with the desktop's
// bearer token, and refreshes the snapshot after each op.
//
// The dialog page header ("Teams / Every Weft team you're in…") is rendered
// by SettingsDialog from lib/settings-nav.ts, so this component opens
// straight on its own cards. The default team is usually there already: the
// top bar prefetches it and the one you last picked once you're signed in
// (warmTeams in lib/team-cache.ts, which also keeps the last answers on disk
// for a cold start), the page then warms the rest of your teams, and hovering
// a row prefetches that one, so "Loading" shows only the first time ever. While a switch loads, the list stays
// up from the team you switched from (`last` in lib/use-managed-team.ts).
// The shared components' wz-* classes take the board's tokens from
// team/team-board.css under .wz-board.
import "./team/team-board.css";
import { openTeamPage } from "./board-palette";
import { Spinner } from "./Icon";
import { Section, SUBTLE, BUTTON } from "./team/SettingsSection";
import { TeamList } from "./team/TeamList";
import { TeamPanel } from "./team/TeamPanel";
import { useBoardRepos } from "@/lib/use-board-repos";
import { useManagedTeam } from "@/lib/use-managed-team";
import { prefetchTeam, prefetchTeams } from "@/lib/use-team";
import { useEffect } from "react";

function Loading({ name }: { name?: string }) {
  return (
    <Section>
      <div className={`flex items-center gap-2 ${SUBTLE}`}>
        <Spinner size={12} /> {name ? `Loading ${name}` : "Loading your teams"}
      </div>
    </Section>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Section>
      <div className="flex flex-col gap-2">
        <p className="break-words text-[12.5px] text-danger">Couldn&apos;t load the team: {message}</p>
        <div>
          <button type="button" onClick={onRetry} className={BUTTON}>
            Try again
          </button>
        </div>
      </div>
    </Section>
  );
}

export default function TeamSettings() {
  const { state, refresh, actions, setOrg, selected, last } = useManagedTeam();
  const boardRepos = useBoardRepos(state.kind === "ok");
  // Your other teams, loaded behind the one on screen, so a switch opens instantly too.
  const slugs = last?.orgs.map((o) => o.slug).join(" ") ?? "";
  useEffect(() => {
    if (slugs) prefetchTeams(slugs.split(" "));
  }, [slugs]);

  if (state.kind === "signed-out") {
    return (
      <Section>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink">Sign in to your Weft account to see your teams.</p>
          <p className={SUBTLE}>The sign-in lives in Settings → Accounts.</p>
          <div>
            <button type="button" onClick={openTeamPage} className={BUTTON}>
              Open on weft.zip
            </button>
          </div>
        </div>
      </Section>
    );
  }

  if (!last) return state.kind === "error" ? <LoadError message={state.message} onRetry={refresh} /> : <Loading />;

  const switching = last.orgs.find((o) => o.slug === selected)?.name;
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={`Your teams · ${last.orgs.length}`}
        aside={
          <button type="button" onClick={openTeamPage} className={BUTTON}>
            Open on weft.zip
          </button>
        }
      >
        <TeamList
          orgs={last.orgs}
          current={selected}
          loading={state.kind === "loading"}
          roleLabels={last.roleLabels}
          actions={actions}
          onSwitch={setOrg}
          onHover={prefetchTeam}
        />
      </Section>

      {state.kind === "ok" ? <TeamPanel team={state.team} actions={actions} boardRepos={boardRepos} /> : null}
      {state.kind === "loading" ? <Loading name={switching} /> : null}
      {state.kind === "error" ? <LoadError message={state.message} onRetry={refresh} /> : null}
    </div>
  );
}
