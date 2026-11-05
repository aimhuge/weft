// @vitest-environment happy-dom
// The fake microphone, recorder, audio graph and speech recognizer the dictation tests run
// against, shared by the tests of lib/use-dictation.ts. The mocked client lives in each test
// file, since vi.mock has to be declared where the module under test is imported.
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

export interface DictationApi {
  dictation: ReturnType<typeof vi.fn>;
  transcribe: ReturnType<typeof vi.fn>;
}

// The whisper status is cached at module level, so each test loads a fresh copy of the hook.
export async function loadHook() {
  vi.resetModules();
  return (await import("./use-dictation")).useDictation;
}

export async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

export let supportedTypes: string[] = [];
export let samples: number[] = [];
export let frames: FrameRequestCallback[] = [];

// The formats the fake recorder accepts; a test narrows the list to see which one is picked.
export function setSupportedTypes(types: string[]) {
  supportedTypes = types;
}

export class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => supportedTypes.includes(type);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => Promise<void>) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    void Promise.resolve().then(() => this.onstop?.());
  });
  constructor(
    public stream: unknown,
    public options?: { mimeType: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

export const audioClose = vi.fn(() => Promise.resolve());

export class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      getByteTimeDomainData(out: Uint8Array) {
        out.set(samples.slice(0, out.length));
      },
    };
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  close = audioClose;
}

export const trackStop = vi.fn();
export const getUserMedia = vi.fn();

// The recorder the hook made last, for a test to look at.
export function recorder(): FakeRecorder {
  const last = FakeRecorder.instances[FakeRecorder.instances.length - 1];
  if (!last) throw new Error("No recorder yet.");
  return last;
}

// ---- Fake browser speech recognition ----------------------------------------------------------

export type Result = { isFinal: boolean; 0: { transcript: string } };

export class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  continuous = false;
  interimResults = true;
  lang = "";
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognizer.instances.push(this);
  }
}

export function final(transcript: string, isFinal = true): Result {
  return { isFinal, 0: { transcript } };
}

export function installFakes(api: DictationApi) {
  beforeEach(() => {
    supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    samples = new Array<number>(512).fill(128);
    frames = [];
    FakeRecorder.instances = [];
    FakeRecognizer.instances = [];
    api.dictation.mockResolvedValue({ available: true });
    api.transcribe.mockResolvedValue("hello world");
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }, { stop: trackStop }] });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete window.weft;
  });
}
