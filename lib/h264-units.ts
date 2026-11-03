// A raw H.264 byte stream (Annex B, as `adb exec-out screenrecord --output-format=h264 -` writes it) cut into access
// units, one frame each, for the RTP packetizer and the "video" channel (lib/rtp-video.ts, lib/worker-fast-screen.ts),
// which take whole frames as idb sends them. A pipe hands over bytes in any size of chunk, so a NAL is only known whole
// when the next start code arrives, or when the stream goes quiet: screenrecord writes a frame at once and nothing on a
// still screen, so a short lull ends the frame rather than leave it waiting for the next change.
//
// A frame starts with an AUD, SEI, SPS or PPS after a slice, or with a slice whose first_mb_in_slice is 0. An IDR that
// comes without its SPS and PPS gets the last ones seen, so a board joining on a later key frame can still decode it.

const START = Buffer.from([0, 0, 0, 1]);
// Quiet this long after a chunk and the last NAL is taken as whole.
export const FLUSH_MS = 12;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

// Only ever read on a NAL with at least its header byte.
const nalType = (nal: Buffer) => (nal[0] as number) & 31;
const isSlice = (type: number) => type === 1 || type === 5;
// first_mb_in_slice is the first ue(v) of the slice header: 0 is coded as a single 1 bit.
const firstSlice = (nal: Buffer) => ((nal[1] ?? 0) & 0x80) !== 0;

// Each NAL in `bytes` (start codes removed, trailing zeros trimmed), and where the last start code began.
function split(bytes: Buffer): { nals: Buffer[]; last: number } {
  const starts: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push(i);
      i += 2;
    }
  }
  const nals: Buffer[] = [];
  for (let k = 0; k + 1 < starts.length; k++) nals.push(trim(bytes.subarray((starts[k] as number) + 3, starts[k + 1])));
  return { nals, last: starts.length ? (starts[starts.length - 1] as number) : -1 };
}

function trim(nal: Buffer) {
  let end = nal.length;
  while (end > 0 && nal[end - 1] === 0) end--;
  return nal.subarray(0, end);
}

export interface AccessUnits {
  push(chunk: Buffer): void;
  // The stream ended: what's held is a whole frame.
  end(): void;
  // Drops what's held, and sends nothing more.
  stop(): void;
}

export function accessUnits(onUnit: (unit: Buffer) => void, timers: Timers = realTimers): AccessUnits {
  let held: Buffer = Buffer.alloc(0);
  let unit: Buffer[] = [];
  let sliced = false;
  let sps: Buffer | null = null;
  let pps: Buffer | null = null;
  let timer: unknown = null;
  let stopped = false;

  const emit = () => {
    if (sliced) {
      const types = unit.map(nalType);
      const params = types.includes(5) && !types.includes(7) && sps && pps ? [sps, pps] : [];
      onUnit(Buffer.concat([...params, ...unit].flatMap((nal) => [START, nal])));
    }
    unit = [];
    sliced = false;
  };

  const take = (nal: Buffer) => {
    if (!nal.length) return;
    const type = nalType(nal);
    if (sliced && ((type >= 6 && type <= 9) || (isSlice(type) && firstSlice(nal)))) emit();
    if (type === 7) sps = Buffer.from(nal);
    if (type === 8) pps = Buffer.from(nal);
    unit.push(Buffer.from(nal));
    sliced ||= isSlice(type);
  };

  const flush = () => {
    timer = null;
    const { last } = split(held);
    if (last >= 0) take(trim(held.subarray(last + 3)));
    held = Buffer.alloc(0);
    emit();
  };

  return {
    push(chunk) {
      if (stopped) return;
      held = Buffer.concat([held, chunk]);
      const { nals, last } = split(held);
      nals.forEach(take);
      // Bytes before any start code belong to no NAL; keep the last one, which may not be whole yet.
      held = last >= 0 ? held.subarray(last) : held.subarray(Math.max(0, held.length - 2));
      if (timer !== null) timers.clear(timer);
      timer = timers.set(flush, FLUSH_MS);
    },
    end() {
      if (stopped) return;
      if (timer !== null) timers.clear(timer);
      flush();
      stopped = true;
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
    },
  };
}
