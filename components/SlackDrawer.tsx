"use client";

import { useEffect, useState } from "react";
import type { SlackChannel, SlackSettings, SlackSettingsPatch, SlackStatus } from "@/lib/slack-types";
import { Note } from "./VaultParts";
import SlackConnect from "./SlackConnect";
import SlackSettingsPanel from "./SlackSettings";

// The Slack drawer (docs/architecture/slack.md): it connects the workspace (the tokens live in Electron
// main's Keychain), picks the channel Weft posts to, says what to post about, and where a card started
// from Slack runs. The setup form is components/SlackConnect.tsx, the connected view SlackSettings.tsx.

export interface SlackDrawerProps {
  status: SlackStatus | null;
  settings: SlackSettings | null;
  folderSynced: boolean;
  synced: string[];
  channels: SlackChannel[];
  // Why the channels couldn't be listed, if they couldn't.
  channelsError: string | null;
  loading: boolean;
  error: string | null;
  note: string | null;
  refresh: () => Promise<void>;
  connect: (bot: string, app: string) => Promise<SlackStatus | null>;
  disconnect: () => Promise<SlackStatus | null>;
  loadChannels: () => Promise<SlackChannel[]>;
  createChannel: (name: string) => Promise<SlackChannel>;
  save: (patch: SlackSettingsPatch) => Promise<unknown>;
  test: () => Promise<unknown>;
  syncFolder: (folder: string) => Promise<boolean>;
  // The board's folders, for the one a Slack card runs in.
  folders: string[];
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}

export default function SlackDrawer({
  status,
  settings,
  folderSynced,
  synced,
  channels,
  channelsError,
  loading,
  error,
  note,
  refresh,
  connect,
  disconnect,
  loadChannels,
  createChannel,
  save,
  test,
  syncFolder,
  folders,
  project,
  onOpenUrl,
  notify,
}: SlackDrawerProps) {
  const [busy, setBusy] = useState(false);

  // The channels load once Slack is connected: when the drawer opens connected, and again right after Connect, which
  // is when a drawer opened before connecting first can ask.
  const signedIn = Boolean(status?.signedIn);
  useEffect(() => {
    if (signedIn) void loadChannels();
  }, [loadChannels, signedIn]);

  // Every action runs the same way: show that it's working, toast what went wrong.
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }

  // The hook's own loading (a refresh in flight) counts as busy too.
  const working = busy || loading;

  if (note) return <Note>{note}</Note>;
  if (error && !status) return <Note>{error}</Note>;
  if (!status) return <Note>Asking Slack…</Note>;

  if (!status.signedIn)
    return (
      <SlackConnect
        busy={working}
        error={status.error ?? error}
        onOpenUrl={onOpenUrl}
        onConnect={async (bot, app) => {
          await run(() => connect(bot, app));
        }}
      />
    );

  return (
    <SlackSettingsPanel
      status={status}
      settings={settings}
      folderSynced={folderSynced}
      synced={synced}
      channels={channels}
      channelsError={channelsError}
      loadChannels={loadChannels}
      createChannel={createChannel}
      busy={working}
      folders={folders}
      project={project}
      save={save}
      test={test}
      syncFolder={syncFolder}
      run={(work) => void run(work)}
      disconnect={disconnect}
      refresh={refresh}
    />
  );
}
