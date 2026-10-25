"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import type { SlackChannel, SlackLink, SlackSettingsPatch } from "@/lib/slack-types";
import { SlackChannelButton, SlackChannelSelect } from "./SlackChannelPicker";

// The Slack drawer's map of projects to their own channels (docs/architecture/slack.md): a mapped project's commits,
// pushes, deploys and card updates go to its channel, and `/weft` or @Weft there starts the card in it. A row saves
// once it has both a project and a channel; the server keeps one channel per project and one project per channel.

const SELECT = "min-w-0 flex-1 rounded-md border border-line-strong bg-card px-1.5 py-1 text-[12px] text-ink disabled:opacity-50";

interface Props {
  links: SlackLink[];
  channels: SlackChannel[];
  folders: string[];
  // The mapped projects that sync to weft.zip; the others get a Turn on sync.
  synced: string[];
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
  onSync: (folder: string) => void;
  // Makes a channel from a row's picker (components/SlackChannelPicker.tsx).
  onCreate: (name: string) => Promise<SlackChannel>;
}

function Row({
  folder,
  channel,
  folders,
  channels,
  busy,
  onChange,
  onRemove,
  onCreate,
}: {
  folder: string;
  channel: string;
  folders: string[];
  channels: SlackChannel[];
  busy: boolean;
  onChange: (folder: string, channel: string) => void;
  onRemove: () => void;
  onCreate: (name: string) => Promise<SlackChannel>;
}) {
  // The channel picker opens under the row, full width (components/SlackChannelPicker.tsx).
  const [picking, setPicking] = useState(false);
  const saved = channels.find((c) => c.id === channel) ?? null;
  return (
    <div>
      <div className="flex items-center gap-1">
        <select value={folder} disabled={busy} aria-label="Project" onChange={(e) => onChange(e.target.value, channel)} className={SELECT}>
          <option value="">Project…</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {folderName(f)}
            </option>
          ))}
        </select>
        <span className="text-faint" aria-hidden>
          ⇄
        </span>
        <SlackChannelButton channel={saved} label="Its channel" placeholder="Channel…" open={picking} busy={busy} onToggle={() => setPicking(!picking)} />
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label="Remove"
          title="Remove"
          className="rounded px-1 text-faint hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          ×
        </button>
      </div>
      {picking && (
        <SlackChannelSelect
          channels={channels}
          title={folder ? `Channel for ${folderName(folder)}` : "Channel"}
          folder={folder || null}
          selected={channel}
          busy={busy}
          onCancel={() => setPicking(false)}
          onCreate={onCreate}
          onPick={(c) => {
            setPicking(false);
            onChange(folder, c?.id ?? "");
          }}
        />
      )}
    </div>
  );
}

export default function SlackLinks({ links, channels, folders, synced, busy, onSave, onSync, onCreate }: Props) {
  // A row still being filled in: it's saved once it has both halves.
  const [draft, setDraft] = useState<{
    folder: string;
    channel: string;
  } | null>(null);
  const nameOf = (id: string) => channels.find((c) => c.id === id)?.name ?? null;
  const save = (next: SlackLink[]) => onSave({ links: next });

  function change(i: number, folder: string, channel: string) {
    if (!folder || !channel) {
      save(links.filter((_, j) => j !== i));
      return;
    }
    save(links.map((l, j) => (j === i ? { folder, channel, channelName: nameOf(channel) } : l)));
  }

  function changeDraft(folder: string, channel: string) {
    if (!folder || !channel) {
      setDraft({ folder, channel });
      return;
    }
    setDraft(null);
    save([...links, { folder, channel, channelName: nameOf(channel) }]);
  }

  // A project not yet mapped, so a new row starts on one.
  const unmapped = folders.filter((f) => !links.some((l) => l.folder === f));
  const unsynced = links.filter((l) => !synced.includes(l.folder));

  return (
    <div className="flex flex-col gap-1">
      {links.map((l, i) => (
        <Row
          key={l.folder}
          folder={l.folder}
          channel={l.channel}
          folders={folders}
          channels={channels}
          busy={busy}
          onChange={(f, c) => change(i, f, c)}
          onCreate={onCreate}
          onRemove={() => save(links.filter((_, j) => j !== i))}
        />
      ))}
      {draft && (
        <Row
          folder={draft.folder}
          channel={draft.channel}
          folders={folders}
          channels={channels}
          busy={busy}
          onChange={changeDraft}
          onCreate={onCreate}
          onRemove={() => setDraft(null)}
        />
      )}
      {!draft && (
        <button
          type="button"
          onClick={() => setDraft({ folder: unmapped[0] ?? "", channel: "" })}
          disabled={busy || !channels.length}
          className="self-start rounded px-1 py-0.5 text-[11.5px] text-accent hover:bg-sunken disabled:opacity-40"
        >
          + Map a project to a channel
        </button>
      )}
      {unsynced.map((l) => (
        <div key={l.folder} className="flex items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-[11px]">
          <span className="min-w-0 flex-1 truncate">{folderName(l.folder)}: weft.zip links need sync</span>
          <button
            type="button"
            onClick={() => onSync(l.folder)}
            disabled={busy}
            className="rounded border border-line-strong px-1.5 text-ink hover:bg-card disabled:opacity-40"
          >
            Turn on sync
          </button>
        </div>
      ))}
    </div>
  );
}
