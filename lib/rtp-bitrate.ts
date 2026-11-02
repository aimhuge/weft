// What the board's RTCP says about the video track, and the encoder rate that follows from it
// (docs/architecture/weft-worker.md#the-fast-path). idb's video stream takes its bitrate only in its Start message and
// has no way to ask for a key frame, so both a new rate and a key frame mean restarting the stream: the first frame of a
// new stream is always an IDR, about 60 ms after the restart on m1mini. A restart costs a key frame, so the rate moves
// only on a sustained, sizeable change.

// RTCP packet types (RFC 3550, 4585) and payload-specific feedback formats.
const SR = 200;
const RR = 201;
const PSFB = 206;
const PLI = 1;
const FIR = 4;

// Never below this: under it the phone's text turns to mush, and a line that can't carry it is better on the JPEGs.
export const MIN_BITRATE = 500_000;
// Loss is judged over this many packets, not per report: the board reports several times a second, and a still screen
// sends a handful of packets a second, so one report's fraction is mostly noise.
const WINDOW = 100;
// Loss after NACK repair that means the line is overrun, and loss low enough to try more.
const OVERRUN = 0.1;
const CLEAR = 0.02;
const DOWN = 0.6;
const UP = 1.5;
// Between restarts; going up waits longer than going down, so a marginal line doesn't swing.
const DOWN_MS = 4_000;
const UP_MS = 12_000;

export interface Feedback {
  // The receiver's running totals: packets lost after repair, and the highest sequence number it has seen.
  lost?: number;
  seq?: number;
  keyframe?: boolean;
}

export interface RtcpLike {
  type: number;
  reports?: { ssrc: number; packetsLost: number; highestSequence: number }[];
  feedback?: { count: number };
}

// The parts of one RTCP packet about the stream sent under ssrc. REMB is left out on purpose: a screen that's mostly
// still sends little, and the board's estimate follows what it gets (about 90 kbps for an idle iPhone on m1mini), so
// it would starve the next scroll.
export function feedbackOf(packet: RtcpLike, ssrc: number): Feedback {
  if (packet.type === SR || packet.type === RR) {
    const report = packet.reports?.find((r) => r.ssrc === ssrc);
    return report ? { lost: report.packetsLost, seq: report.highestSequence } : {};
  }
  const count = packet.type === PSFB ? packet.feedback?.count : undefined;
  return count === PLI || count === FIR ? { keyframe: true } : {};
}

const clamp = (n: number, ceiling: number) => Math.round(Math.min(ceiling, Math.max(MIN_BITRATE, n)));

// Starts at the quality's rate, the ceiling, and returns a new rate from report() only when the encoder should restart
// at it: down by DOWN when loss after repair passes OVERRUN, back up by UP once it has stayed under CLEAR for UP_MS.
export function bitrateControl(ceiling: number, now: () => number = Date.now) {
  let rate = clamp(ceiling, ceiling);
  let changed = now();
  let last: { lost: number; seq: number } | null = null;
  let window = { lost: 0, expected: 0 };
  let clearSince = now();
  const move = (to: number) => {
    if (to === rate) return null;
    rate = to;
    changed = clearSince = now();
    return rate;
  };
  return {
    get rate() {
      return rate;
    },
    report({ lost, seq }: Feedback): number | null {
      if (lost === undefined || seq === undefined) return null;
      const before = last;
      last = { lost, seq };
      if (!before || seq <= before.seq) return null;
      // A repaired packet comes off the running total, so lost can fall between reports.
      window = { lost: window.lost + lost - before.lost, expected: window.expected + seq - before.seq };
      if (window.expected < WINDOW) return null;
      const loss = Math.max(0, window.lost) / window.expected;
      window = { lost: 0, expected: 0 };
      if (loss > OVERRUN) {
        clearSince = now();
        return now() - changed < DOWN_MS ? null : move(clamp(rate * DOWN, ceiling));
      }
      if (loss >= CLEAR) clearSince = now();
      else if (now() - clearSince >= UP_MS && now() - changed >= UP_MS) return move(clamp(rate * UP, ceiling));
      return null;
    },
  };
}
