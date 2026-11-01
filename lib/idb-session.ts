// The open idb connections, by device. Apart from lib/idb-companion.ts so taps (lib/simulator-ui.ts) can look one up
// without pulling gRPC into everything that imports them.
import { globalSingleton } from "./global-singleton";
import type { ScreenQuality } from "./rtc-signal";

export interface IdbSession {
  // The screen in points, the units a tap takes.
  size: { width: number; height: number };
  tap: (x: number, y: number) => Promise<unknown>;
  swipe: (from: { x: number; y: number }, to: { x: number; y: number }, ms: number) => Promise<unknown>;
  // One event of a live gesture or key press, in order, the moment it happens.
  touch: (phase: "down" | "move" | "up", x: number, y: number) => void;
  key: (code: number, down: boolean) => void;
  // Each payload is H.264, at the quality the board picked; the call returned stops the stream.
  video: (onFrame: (frame: Buffer) => void, onEnd: () => void, quality?: ScreenQuality) => () => void;
  close: () => void;
}

const sessions = globalSingleton("__weftIdbSessions", () => new Map<string, IdbSession>());

export const idbFor = (device: string) => sessions.get(device);

export function setIdb(device: string, session: IdbSession) {
  sessions.set(device, session);
}

export function dropIdb(device: string, session: IdbSession) {
  if (sessions.get(device) === session) sessions.delete(device);
}
