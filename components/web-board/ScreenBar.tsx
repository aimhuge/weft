"use client";

// The line over a worker's live screen (components/web-board/WorkerScreen.tsx): which device, where it streams from, how
// it's doing, and the controls a board that can send input gets: the device menu, the video's quality, and Resume once
// the watch ran out. Each starts the stream itself (a `watch` input), so nobody has to ask the thread.
import { useState } from "react";
import { DEFAULT_QUALITY, SCREEN_QUALITIES, screenQuality, type ScreenQuality } from "@/lib/rtc-signal";
import type { ScreenDevice } from "@/lib/share-types";

const QUALITY_KEY = "weft.screen-quality";
const SELECT = "rounded-md border border-line bg-canvas px-1 py-0.5 text-[12px] text-ink";
const QUALITY_LABEL: Record<ScreenQuality, string> = { low: "Low · 15 fps", medium: "Medium · 30 fps", high: "High · 60 fps" };

function stored(): ScreenQuality {
  try {
    return screenQuality(localStorage.getItem(QUALITY_KEY));
  } catch {
    return DEFAULT_QUALITY;
  }
}

// The quality picked last, kept for every worker screen on this board.
export function useScreenQuality(): [ScreenQuality, (q: ScreenQuality) => void] {
  const [quality, setQuality] = useState<ScreenQuality>(stored);
  const pick = (q: ScreenQuality) => {
    setQuality(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      // A board with no storage keeps it for this view.
    }
  };
  return [quality, pick];
}

interface Props {
  label: string;
  device: string;
  devices: ScreenDevice[];
  source?: string;
  status: string;
  ended: boolean;
  // Present when this board can drive the worker: the controls need it.
  watch?: (device: string) => void;
  busy: boolean;
  // Present when the video runs over WebRTC, the only line the quality reaches.
  quality?: { value: ScreenQuality; pick: (q: ScreenQuality) => void };
}

export function ScreenBar({ label, device, devices, source, status, ended, watch, busy, quality }: Props) {
  const choices = devices.some((d) => d.id === device) ? devices : [{ id: device, name: label }, ...devices];
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12px] text-muted">
      {watch && choices.length > 1 ? (
        <select aria-label="Device" className={`${SELECT} font-semibold`} value={device} disabled={busy} onChange={(e) => watch(e.target.value)}>
          {choices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : (
        <b className="text-ink">{label}</b>
      )}
      <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[11px]" title="The simulator runs on the worker; you're watching a stream of it">
        ☁︎ streaming from {source ?? "the worker"}
      </span>
      <span>{status}</span>
      {quality && (
        <select aria-label="Video quality" className={SELECT} value={quality.value} onChange={(e) => quality.pick(screenQuality(e.target.value))}>
          {SCREEN_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABEL[q]}
            </option>
          ))}
        </select>
      )}
      {ended && watch && (
        <button type="button" disabled={busy} onClick={() => watch(device)} className="rounded-md bg-accent px-2 py-0.5 text-[12px] font-medium text-white disabled:opacity-50">
          {busy ? "Starting…" : "▶ Resume"}
        </button>
      )}
    </div>
  );
}
