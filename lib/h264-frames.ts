// The board's side of the fast path's wire format (lib/worker-direct.ts): a 4-byte length, then one whole H.264 payload.

export function frameReader(onFrame: (frame: Uint8Array) => void) {
  let held = new Uint8Array(0);
  return (chunk: Uint8Array) => {
    const all = new Uint8Array(held.length + chunk.length);
    all.set(held);
    all.set(chunk, held.length);
    let at = 0;
    while (all.length - at >= 4) {
      const size = new DataView(all.buffer, at, 4).getUint32(0);
      if (all.length - at - 4 < size) break;
      onFrame(all.subarray(at + 4, at + 4 + size));
      at += 4 + size;
    }
    held = all.slice(at);
  };
}

// Each NAL's byte offset after its start code.
function nalStarts(frame: Uint8Array) {
  const starts: number[] = [];
  for (let i = 0; i + 3 < frame.length; i++) {
    if (frame[i] === 0 && frame[i + 1] === 0 && frame[i + 2] === 1) starts.push(i + 3);
  }
  return starts;
}

export const isKey = (frame: Uint8Array) => nalStarts(frame).some((at) => ((frame[at] ?? 0) & 31) === 5);

const hex = (n: number) => n.toString(16).padStart(2, "0");

// The codec string WebCodecs wants, from the SPS's profile, constraints and level; null until a frame carries one.
export function codecOf(frame: Uint8Array) {
  const at = nalStarts(frame).find((start) => ((frame[start] ?? 0) & 31) === 7);
  if (at === undefined || at + 3 >= frame.length) return null;
  return `avc1.${hex(frame[at + 1] ?? 0)}${hex(frame[at + 2] ?? 0)}${hex(frame[at + 3] ?? 0)}`;
}
