// A watched simulator on a worker's session line (lib/host-line.ts): the board's offer names the device and the label of
// the input channel it opens with it, and this attaches the device's fast screen (lib/worker-screen.ts) to the offer's
// new video m-line. The same checks as the relay's `input` kind: the device must be watched by a card this worker runs
// (not the copilot), the label must be `input:<device>:<nonce>`, one track per device per line, and that channel
// closing is what stops it.
import { deviceOfChannel, type LineScreen } from "./host-line-protocol";
import type { VideoTransceiver } from "./rtp-video";
import type { Card } from "./types";
import type { Channel } from "./worker-rtc";
import type { FastScreen } from "./worker-screen";

export interface ScreenDeps {
  screen?: (device: string) => FastScreen | null;
  // The card watching a device, for the relay's ownCard check.
  watcher?: (device: string) => Card | undefined;
}

type Track = { label: string; stop: () => void };

export function lineScreens(deps: ScreenDeps) {
  const tracks = new Map<string, Track>();
  const seen = new Set<VideoTransceiver>();

  // The device's fast screen, when a card of this worker's own is watching it.
  function owned(device: string): FastScreen | null {
    const card = deps.watcher?.(device);
    return card && card.role !== "copilot" ? (deps.screen?.(device) ?? null) : null;
  }

  function stop(device: string, label?: string) {
    const track = tracks.get(device);
    if (!track || (label && track.label !== label)) return;
    tracks.delete(device);
    track.stop();
  }

  return {
    // Marks the m-lines an offer already had, so a later offer's media is only what it adds.
    note: (transceivers: VideoTransceiver[]) => transceivers.forEach((t) => seen.add(t)),
    // What an offer over the line adds: its new m-lines, carrying the named screen when every check passes.
    media(screen: LineScreen | undefined) {
      const fast = screen?.channel && deviceOfChannel(screen.channel) === screen.device ? owned(screen.device) : null;
      return (transceivers: VideoTransceiver[]) => {
        const fresh = transceivers.filter((t) => !seen.has(t));
        fresh.forEach((t) => seen.add(t));
        const started = screen && fast?.attach?.(fresh, screen.quality);
        if (!screen?.channel || !started) return;
        stop(screen.device);
        tracks.set(screen.device, { label: screen.channel, stop: started });
      };
    },
    // An `input:<device>:<nonce>` channel: gestures for an owned device, and its closing stops that track.
    input(channel: Channel & { close?: () => void }) {
      const device = deviceOfChannel(channel.label);
      const fast = device ? owned(device) : null;
      if (!device || !fast?.input) {
        channel.close?.();
        return;
      }
      fast.input(channel);
      channel.stateChanged.subscribe((state) => {
        if (state === "closed") stop(device, channel.label);
      });
    },
    closeAll() {
      [...tracks.keys()].forEach((device) => stop(device));
    },
  };
}
