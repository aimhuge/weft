// Dictation's recording as the WAV whisper.cpp reads as it is: 16 kHz, mono, 16-bit. On Windows the board sends this
// instead of the recorder's webm, so the packaged app needs no ffmpeg to transcode it (lib/transcribe.ts,
// docs/architecture/windows.md). Chromium decodes the webm and resamples it itself, in an OfflineAudioContext.

export const WHISPER_RATE = 16_000;

/** A mono 16-bit PCM WAV file of samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, rate = WHISPER_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const clipped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return buffer;
}

type OfflineContext = new (channels: number, length: number, rate: number) => OfflineAudioContext;

/** The recording, decoded and resampled to 16 kHz mono, as a WAV blob. */
export async function toWhisperWav(recording: Blob, Context: OfflineContext = OfflineAudioContext): Promise<Blob> {
  const decoded = await new Context(1, 1, WHISPER_RATE).decodeAudioData(await recording.arrayBuffer());
  const context = new Context(1, Math.max(1, Math.ceil(decoded.duration * WHISPER_RATE)), WHISPER_RATE);
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0))], { type: "audio/wav" });
}

/** Whether this board is on Windows, where dictation sends WAV. */
export const sendsWav = (userAgent: string = navigator.userAgent) => /Windows/.test(userAgent);
