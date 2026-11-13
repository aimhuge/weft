// The microphone for dictation: which input to use (Settings → General → Dictation → Microphone,
// kept in this browser's localStorage so the board and the dictation pill share it), and a warm
// stream kept open for a while after a recording so the next one starts capturing at once instead
// of losing its first words while the mic opens.

const KEY = "weft.dictation.micId";
// How long the mic stays open after a recording. macOS shows its mic dot for this long.
export const WARM_MS = 30_000;

export function micId(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setMicId(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or no storage: the system default it is.
  }
  closeWarmMic();
}

let warm: { stream: MediaStream; id: string; timer: ReturnType<typeof setTimeout> | null } | null = null;

function live(stream: MediaStream) {
  return stream.getAudioTracks().some((t) => t.readyState === "live");
}

// The chosen input, reusing the warm stream when it is still open for that input.
export async function openMic(): Promise<MediaStream> {
  const id = micId() || (warm?.id ?? "") || (await wiredMic());
  if (warm && warm.id === id && live(warm.stream)) {
    if (warm.timer) clearTimeout(warm.timer);
    warm.timer = null;
    return warm.stream;
  }
  closeWarmMic();
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
  if (id) audio.deviceId = { ideal: id };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  warm = { stream, id, timer: null };
  return stream;
}

// Done recording: keep the mic open for WARM_MS (or close it now when keep is false).
export function releaseMic(stream: MediaStream, keep = true) {
  if (!warm || warm.stream !== stream) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  if (!keep) {
    closeWarmMic();
    return;
  }
  if (warm.timer) clearTimeout(warm.timer);
  warm.timer = setTimeout(closeWarmMic, WARM_MS);
}

export function closeWarmMic() {
  if (!warm) return;
  if (warm.timer) clearTimeout(warm.timer);
  warm.stream.getTracks().forEach((t) => t.stop());
  warm = null;
}

// Bluetooth mics (AirPods and the like) are slow to open and drop to call quality, so with no input
// chosen, dictation skips them for the first wired or built-in one. Labels need mic permission once;
// before that, "" leaves it to the system default.
export const BLUETOOTH = /bluetooth|airpods|buds|beats|headset|hands-free|wh-1000|bose/i;

export async function wiredMic(): Promise<string> {
  try {
    const mics = await listMics();
    if (!mics.some((m) => BLUETOOTH.test(m.label))) return "";
    return mics.find((m) => !BLUETOOTH.test(m.label))?.id ?? "";
  } catch {
    return "";
  }
}

// The inputs to choose from. Labels are empty until the page has had mic permission once.
export async function listMics(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
