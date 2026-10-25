"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import { EVENT_KEYS, EVENT_LABELS, SOCKET_STATE, type SlackEventKey, type SlackSettings, type SlackStatus } from "@/lib/slack-view";
import type { SlackChannel, SlackSettingsPatch } from "@/lib/slack-types";
import { SlackChannelButton, SlackChannelSelect } from "./SlackChannelPicker";
import SlackLinks from "./SlackLinks";
import SlackRoutes from "./SlackRoutes";

// The connected Slack drawer (components/SlackSettings.tsx): the workspace and its socket, the default channel
// Weft posts to, the four things it can post about, projects mapped to channels of their own (components/SlackLinks.tsx),
// and the default project a card started from Slack runs in.

export interface SlackSettingsProps {
  status: SlackStatus;
  settings: SlackSettings | null;
  folderSynced: boolean;
  // The default and mapped projects that sync to weft.zip.
  synced: string[];
  channels: SlackChannel[];
  channelsError: string | null;
  loadChannels: () => Promise<unknown>;
  // A new public channel from a picker (electron/slack-channels.cjs).
  createChannel: (name: string) => Promise<SlackChannel>;
  busy: boolean;
  // The board's folders, for the one a Slack card runs in.
  folders: string[];
  project: string | null;
  save: (patch: SlackSettingsPatch) => Promise<unknown>;
  test: () => Promise<unknown>;
  syncFolder: (folder: string) => Promise<boolean>;
  // Every action goes through the drawer's runner, so a failure is toasted and the buttons wait.
  run: (work: () => Promise<unknown>) => void;
  disconnect: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
}

export default function SlackSettings({
  status,
  settings,
  folderSynced,
  synced,
  channels,
  channelsError,
  loadChannels,
  createChannel,
  busy,
  folders,
  project,
  save,
  test,
  syncFolder,
  run,
  disconnect,
  refresh,
}: SlackSettingsProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header status={status} busy={busy} onDisconnect={() => run(() => disconnect())} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 text-[12.5px] leading-snug text-muted">
        <Field label="Default channel">
          <ChannelPicker channels={channels} settings={settings} busy={busy} onSave={(patch) => run(() => save(patch))} onCreate={createChannel} />
          <ChannelsNote channels={channels} error={channelsError} busy={busy} onReload={() => run(() => loadChannels())} />
        </Field>

        <Field label="Post about">
          <div className="flex flex-col gap-1">
            {EVENT_KEYS.map((key) => (
              <EventToggle key={key} eventKey={key} settings={settings} busy={busy} onSave={(patch) => run(() => save(patch))} />
            ))}
          </div>
        </Field>

        <Field label="Channel per kind">
          <SlackRoutes
            settings={settings}
            channels={channels}
            busy={busy}
            onSave={(patch) => run(() => save(patch))}
            onCreate={createChannel}
          />
          <p className="mt-1 text-[11px] text-faint">A kind with a channel of its own goes there, whatever project it happened in.</p>
        </Field>

        <Field label="Project channels">
          <SlackLinks
            links={settings?.links ?? []}
            channels={channels}
            folders={folders}
            synced={synced}
            busy={busy}
            onSave={(patch) => run(() => save(patch))}
            onSync={(folder) => run(() => syncFolder(folder))}
            onCreate={createChannel}
          />
        </Field>

        <Field label="Cards from other channels start in">
          <FolderPicker folders={folders} project={project} settings={settings} busy={busy} onSave={(patch) => run(() => save(patch))} />
        </Field>

        {settings?.folder && !folderSynced && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md bg-sunken px-2 py-1.5 text-[11.5px]">
            <span className="min-w-0 flex-1">Links open the card on weft.zip once this project syncs</span>
            <button
              type="button"
              onClick={() => run(() => syncFolder(settings.folder as string))}
              disabled={busy}
              className="rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-card disabled:opacity-40"
            >
              Turn on sync
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(() => test())}
            disabled={busy}
            className="rounded-md border border-line-strong px-2.5 py-1 text-[11.5px] text-ink hover:bg-sunken disabled:opacity-40"
          >
            Send a test message
          </button>
          <button
            type="button"
            onClick={() => run(() => refresh())}
            disabled={busy}
            className="rounded-md px-2 py-1 text-[11.5px] text-faint hover:text-ink disabled:opacity-40"
          >
            Refresh
          </button>
        </div>

        <p className="mt-3 text-[11.5px] text-faint">
          In Slack: <span className="text-muted">/weft &lt;what to build&gt;</span>, or <span className="text-muted">@Weft</span> in a channel. @Weft in a
          card&apos;s thread talks to that card.
        </p>
      </div>
    </div>
  );
}

// The workspace, the bot, and the socket's dot.
function Header({ status, busy, onDisconnect }: { status: SlackStatus; busy: boolean; onDisconnect: () => void }) {
  const socket = SOCKET_STATE[status.socket];
  const dot = socket.tone === "ok" ? "bg-ok" : socket.tone === "warn" ? "bg-warn" : "bg-line-strong";
  return (
    <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-muted">
      <span className={`h-[7px] w-[7px] flex-none rounded-full ${dot}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={socket.label}>
        {status.team ?? "Slack"}
        {status.bot ? ` · ${status.bot}` : ""} · {socket.label}
      </span>
      <button onClick={onDisconnect} disabled={busy} className="rounded px-1.5 py-0.5 text-[11px] hover:bg-sunken hover:text-ink disabled:opacity-40">
        Disconnect
      </button>
    </div>
  );
}

// Under the channel picker while it has nothing to offer: Slack's reason, or that it's still asking, and a way to ask again
// (after an /invite, or a reinstall that added a scope).
function ChannelsNote({ channels, error, busy, onReload }: { channels: SlackChannel[]; error: string | null; busy: boolean; onReload: () => void }) {
  if (channels.length && !error) return null;
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
      <span className={`min-w-0 flex-1 ${error ? "text-danger" : "text-faint"}`}>{error ?? "Asking Slack for channels…"}</span>
      <button type="button" onClick={onReload} disabled={busy} className="rounded px-1 text-accent hover:bg-sunken disabled:opacity-40">
        Reload channels
      </button>
    </div>
  );
}

// One labelled row of the connected drawer.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      {children}
    </div>
  );
}

// The default channel: a button naming it, and the drawers' search picker to change it (components/SlackChannelPicker.tsx).
function ChannelPicker({
  channels,
  settings,
  busy,
  onSave,
  onCreate,
}: {
  channels: SlackChannel[];
  settings: SlackSettings | null;
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
  onCreate: (name: string) => Promise<SlackChannel>;
}) {
  const [open, setOpen] = useState(false);
  // The saved channel is the value: the server's answer is the truth, and the pick is saved straight away.
  const value = settings?.channel ?? "";
  // A saved channel the list doesn't have (yet) still shows by its saved name.
  const saved =
    channels.find((c) => c.id === value) ??
    (value
      ? {
          id: value,
          name: settings?.channelName ?? value,
          isPrivate: false,
          isMember: true,
        }
      : null);
  return (
    <>
      <div className="flex">
        <SlackChannelButton channel={saved} label="Channel" placeholder="No default channel" open={open} busy={busy} onToggle={() => setOpen(!open)} />
      </div>
      {open && (
        <SlackChannelSelect
          channels={channels}
          title="Default channel"
          folder={null}
          selected={value}
          busy={busy}
          onCancel={() => setOpen(false)}
          onCreate={onCreate}
          onPick={(channel) => {
            setOpen(false);
            onSave({
              channel: channel?.id ?? null,
              channelName: channel?.name ?? null,
            });
          }}
        />
      )}
    </>
  );
}

// One of the four things Weft can post about.
function EventToggle({
  eventKey,
  settings,
  busy,
  onSave,
}: {
  eventKey: SlackEventKey;
  settings: SlackSettings | null;
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
}) {
  const on = Boolean(settings?.events[eventKey]);
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={(e) => onSave({ events: { [eventKey]: e.target.checked } })}
        className="accent-[var(--accent)]"
      />
      {EVENT_LABELS[eventKey]}
    </label>
  );
}

// The folder a card started from Slack runs in.
function FolderPicker({
  folders,
  project,
  settings,
  busy,
  onSave,
}: {
  folders: string[];
  project: string | null;
  settings: SlackSettings | null;
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
}) {
  const value = settings?.folder ?? "";
  return (
    <select
      value={value}
      disabled={busy}
      aria-label="Cards from Slack start in"
      onChange={(e) => onSave({ folder: e.target.value || null })}
      className="w-full rounded-md border border-line-strong bg-card px-2 py-1.5 text-[12.5px] text-ink disabled:opacity-50"
    >
      <option value="">No default project</option>
      {folders.map((f) => (
        <option key={f} value={f}>
          {folderName(f)}
          {f === project ? " (this project)" : ""}
        </option>
      ))}
    </select>
  );
}
