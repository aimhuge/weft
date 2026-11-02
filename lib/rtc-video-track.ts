"use client";

// The board's side of the screen as an RTP video track (lib/rtp-video.ts on the worker): it offers a receive-only video
// m-line that takes H.264 in packetization-mode 1, and plays what arrives in a <video> with the browser's own decoder.
// A board or browser without it offers no m-line, and the worker sends on the "video" DataChannel instead.

type Codec = { mimeType: string; sdpFmtpLine?: string };

// High first, since that's what idb encodes; then Constrained Baseline, then any other H.264 profile.
const rank = (c: Codec) => {
  const profile = /profile-level-id=([0-9a-f]{4})/i.exec(`${c.sdpFmtpLine}`)?.[1]?.toLowerCase() ?? "";
  if (profile.startsWith("64")) return 0;
  return profile === "42e0" ? 1 : 2;
};

export function h264First<C extends Codec>(codecs: C[]): C[] {
  return codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264" && /packetization-mode=1/.test(c.sdpFmtpLine ?? "")).sort((a, b) => rank(a) - rank(b));
}

// Adds the m-line, or returns false when this browser can't receive H.264 over RTP.
export function offerVideoTrack(pc: RTCPeerConnection): boolean {
  if (typeof pc.addTransceiver !== "function" || typeof RTCRtpReceiver === "undefined") return false;
  const codecs = h264First(RTCRtpReceiver.getCapabilities("video")?.codecs ?? []);
  if (!codecs.length) return false;
  const t = pc.addTransceiver("video", { direction: "recvonly" });
  t.setCodecPreferences(codecs);
  // A live screen, not a call to keep smooth: show each frame as soon as it's decoded.
  const receiver = t.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null };
  if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
  return true;
}

// Plays the track and calls onFrame once, when the first frame is on screen.
export function playTrack(video: HTMLVideoElement, track: MediaStreamTrack, onFrame: () => void) {
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => onFrame());
  else video.addEventListener("loadeddata", onFrame, { once: true });
  void video.play().catch(() => {});
}
