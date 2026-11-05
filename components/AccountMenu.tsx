"use client";

import { useSyncExternalStore } from "react";
import { replayLastAchievement } from "@/lib/achievement-replay";
import { showProgress, subscribeBoardPrefs } from "@/lib/board-prefs";
import type { useCloudSync } from "@/lib/use-cloud-sync";
import { replayWelcome } from "@/lib/welcome-client";
import AccountPlan from "./AccountPlan";
import AccountSync from "./AccountSync";
import { openTeamPage } from "./board-palette";
import Icon, { type IconName } from "./Icon";

// The avatar's tiny menu (components/AccountButton.tsx): your team, plan and an upgrade button on top, then board sync
// (components/AccountSync.tsx), then Settings, Share the board, Your team, Replay the welcome, and Replay last achievement
// while Settings > Show progress is on. Every item below sync closes the menu, then acts.
export default function AccountMenu({
  id,
  onClose,
  onOpenSettings,
  onShareBoard,
  sync,
  project,
}: {
  id: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onShareBoard?: () => void;
  sync: ReturnType<typeof useCloudSync>;
  project: string | null;
}) {
  const progress = useSyncExternalStore(subscribeBoardPrefs, showProgress, () => true);
  const pick = (act: () => void) => () => {
    onClose();
    act();
  };
  return (
    <div id={id} role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-[240px] rounded-lg border border-line bg-panel p-1 shadow-lg">
      <AccountPlan onClose={onClose} />
      <AccountSync sync={sync} project={project} />
      <MenuItem icon="sliders" label="Settings…" onClick={pick(onOpenSettings)} />
      {onShareBoard && <MenuItem icon="share" label="Share the board…" onClick={pick(onShareBoard)} />}
      <MenuItem icon="globe" label="Your team" sub="Invite teammates on weft.zip" onClick={pick(openTeamPage)} />
      <MenuItem icon="play" label="Replay the welcome" onClick={pick(replayWelcome)} />
      {progress && <MenuItem icon="sparkles" label="Replay last achievement" onClick={pick(replayLastAchievement)} />}
    </div>
  );
}

function MenuItem({ icon, label, sub, onClick }: { icon: IconName; label: string; sub?: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-sunken">
      <span className="flex w-full items-center gap-2 text-[13px] text-ink">
        <Icon name={icon} size={14} className="text-muted" />
        {label}
      </span>
      {sub && <span className="pl-6 text-[11.5px] leading-snug text-muted">{sub}</span>}
    </button>
  );
}
