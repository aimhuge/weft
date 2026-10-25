"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import { channelHint, channelRows, slackChannelName } from "@/lib/slack-view";
import type { SlackChannel } from "@/lib/slack-types";
import DbSelect, { DbNewButton, DbRowLines } from "./DbSelect";

// The Slack drawer's channel field (docs/architecture/slack.md): a button naming the channel, and the provider
// drawers' own search picker (components/DbSelect.tsx) under it to change it. A workspace lists dozens of channels,
// so it narrows as you type; for a project's row, channels named like the project come first as best fits. A channel
// that isn't there yet is made from the same list: + New channel, named after what you typed or the project.

export function SlackChannelButton({
  channel,
  label,
  placeholder,
  open,
  busy,
  onToggle,
}: {
  channel: SlackChannel | null;
  // The field's accessible name: "Channel", "Its channel".
  label: string;
  placeholder: string;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-label={label}
      aria-expanded={open}
      className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-1 text-left text-[12px] disabled:opacity-50"
    >
      <span className={`min-w-0 flex-1 truncate ${channel ? "text-ink" : "text-faint"}`}>{channel ? `#${channel.name}` : placeholder}</span>
      <span className="text-[10px] text-faint" aria-hidden>
        ▾
      </span>
    </button>
  );
}

export function SlackChannelSelect({
  channels,
  title,
  folder,
  selected,
  busy,
  onPick,
  onCancel,
  onCreate,
}: {
  channels: SlackChannel[];
  // "Default channel", "Channel for weft".
  title: string;
  // The project the channel is for, which ranks channels named like it first; null for the default channel.
  folder: string | null;
  // The saved channel's id: offers "No channel" to clear it.
  selected: string;
  busy: boolean;
  onPick: (channel: SlackChannel | null) => void;
  onCancel: () => void;
  // Makes a public channel in Slack (main's conversations.create); the new channel is then picked.
  onCreate: (name: string) => Promise<SlackChannel>;
}) {
  const [search, setSearch] = useState("");
  // The new channel's name while its form is open; null while the list shows.
  const [creating, setCreating] = useState<string | null>(null);
  const suggestion = slackChannelName(search) || (folder ? slackChannelName(folderName(folder)) : "");
  return (
    <DbSelect
      title={title}
      ariaLabel={title}
      rows={channelRows(channels, search, folder)}
      loading="Asking Slack for channels…"
      search={search}
      onSearch={setSearch}
      searchLabel="Search channels"
      searchPlaceholder="Type a channel's name"
      emptyText={search ? "No channel matches." : "Slack listed no channels. Reload channels, or /invite @Weft to a private one."}
      busy={busy}
      rowKey={(c) => c.id}
      onPick={onPick}
      onCancel={onCancel}
      hideSearch={creating !== null}
      extra={
        creating !== null ? (
          <NewChannelForm initial={creating} onCreate={onCreate} onMade={onPick} onBack={() => setCreating(null)} />
        ) : (
          <>
            <DbNewButton label="New channel" hint={suggestion ? `#${suggestion}` : undefined} disabled={busy} onClick={() => setCreating(suggestion)} />
            {selected ? (
              <button
                type="button"
                onClick={() => onPick(null)}
                disabled={busy}
                className="mt-1 rounded px-1 text-[11px] text-faint hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                No channel
              </button>
            ) : null}
          </>
        )
      }
      renderRow={(c, score) => (
        <DbRowLines
          name={`#${c.name}`}
          score={score}
          detail={
            channelHint(c)
              .trim()
              .replace(/^\(|\)$/g, "") || undefined
          }
        />
      )}
    />
  );
}

// The new channel's name and Create. Slack's refusal (a taken name, a missing scope) shows under it, and the form
// stays open to try another name.
function NewChannelForm({
  initial,
  onCreate,
  onMade,
  onBack,
}: {
  initial: string;
  onCreate: (name: string) => Promise<SlackChannel>;
  onMade: (channel: SlackChannel) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initial);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = slackChannelName(name);

  async function create() {
    if (!clean) return;
    setWorking(true);
    setError(null);
    try {
      onMade(await onCreate(clean));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWorking(false);
    }
  }

  return (
    <form
      className="mt-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="flex items-center gap-1">
        <span className="text-[12px] text-faint" aria-hidden>
          #
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onBack();
          }}
          aria-label="New channel's name"
          placeholder="new-channel"
          disabled={working}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
        />
        <button type="submit" disabled={working || !clean} className="rounded-md bg-accent px-2 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {working ? "Creating…" : "Create"}
        </button>
      </div>
      {clean && clean !== name.replace(/^#+/, "") && <p className="mt-1 text-[10.5px] text-faint">Slack will name it #{clean}</p>}
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
      <button type="button" onClick={onBack} disabled={working} className="mt-1 rounded px-1 text-[11px] text-faint hover:bg-sunken hover:text-ink">
        Back to the list
      </button>
    </form>
  );
}
