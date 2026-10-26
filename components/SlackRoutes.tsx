"use client";

import { useState } from "react";
import { EVENT_LABELS, SLACK_KINDS, type SlackEventKey } from "@/lib/slack-view";
import type { SlackChannel, SlackSettings, SlackSettingsPatch } from "@/lib/slack-types";
import { SlackChannelButton, SlackChannelSelect } from "./SlackChannelPicker";

// Where each kind of update goes, when it is not the default channel (docs/architecture/slack.md).
//
// One row per kind: the channel it goes to, or "Default" for the drawer's default channel (and a project's own
// channel, for a project that has one). A kind's channel wins over a project's — that is what routing commits
// to one channel and deploys to another means.

export interface SlackRoutesProps {
  settings: SlackSettings | null;
  channels: SlackChannel[];
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
  onCreate: (name: string) => Promise<SlackChannel>;
}

export default function SlackRoutes({ settings, channels, busy, onSave, onCreate }: SlackRoutesProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {SLACK_KINDS.map((key) => (
        <RouteRow key={key} eventKey={key} settings={settings} channels={channels} busy={busy} onSave={onSave} onCreate={onCreate} />
      ))}
    </div>
  );
}

// One kind: the channel it goes to, and the picker to change it.
function RouteRow({
  eventKey,
  settings,
  channels,
  busy,
  onSave,
  onCreate,
}: {
  eventKey: SlackEventKey;
  settings: SlackSettings | null;
  channels: SlackChannel[];
  busy: boolean;
  onSave: (patch: SlackSettingsPatch) => void;
  onCreate: (name: string) => Promise<SlackChannel>;
}) {
  const [open, setOpen] = useState(false);
  const route = settings?.routes[eventKey];
  const value = route?.channel ?? "";
  // A saved channel the list doesn't have (yet) still shows by its saved name.
  const saved =
    channels.find((c) => c.id === value) ??
    (value
      ? {
          id: value,
          name: route?.channelName ?? value,
          isPrivate: false,
          isMember: true,
        }
      : null);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{EVENT_LABELS[eventKey]}</span>
        <div className="flex min-w-0 flex-1 justify-end">
          <SlackChannelButton
            channel={saved}
            label={`Channel for ${EVENT_LABELS[eventKey]}`}
            placeholder="Default"
            open={open}
            busy={busy}
            onToggle={() => setOpen(!open)}
          />
        </div>
      </div>
      {open && (
        <SlackChannelSelect
          channels={channels}
          title={`Channel for ${EVENT_LABELS[eventKey]}`}
          folder={null}
          selected={value}
          busy={busy}
          onCancel={() => setOpen(false)}
          onCreate={onCreate}
          onPick={(channel) => {
            setOpen(false);
            // No channel means "the default": the row is cleared, not set to an empty channel.
            onSave({ routes: { [eventKey]: channel ? { channel: channel.id, channelName: channel.name } : null } });
          }}
        />
      )}
    </>
  );
}
