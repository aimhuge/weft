import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationPrefs } from "@/lib/dictation-types";
import { GET, PATCH } from "./route";

// The settings card's own view: the prefs, whether whisper-server is installed, the model it would
// keep loaded and the download's state. The server, the model and the prefs are all mocked, so no
// file is written, no model is fetched and no process is started.
vi.mock("next/server", () => ({ connection: async () => {} }));

const DEFAULTS: DictationPrefs = { language: "system", advanced: false, vocabulary: "" };

const prefs = vi.hoisted(() => ({
  value: { language: "system", advanced: false, vocabulary: "" },
  written: [] as Record<string, unknown>[],
  languages: ["system", "auto", "en", "fr", "de", "es"],
}));
vi.mock("@/lib/dictation-prefs", () => ({
  readDictationPrefs: () => ({ ...prefs.value }),
  writeDictationPrefs: (patch: Record<string, unknown>) => {
    const language = patch.language;
    if (typeof language === "string" && !prefs.languages.includes(language)) {
      throw new Error(`Dictation can't listen for ${JSON.stringify(language)}.`);
    }
    if (patch.advanced !== undefined && typeof patch.advanced !== "boolean") throw new Error("advanced must be true or false.");
    if (patch.vocabulary !== undefined && typeof patch.vocabulary !== "string") throw new Error("vocabulary must be text.");
    prefs.written.push(patch);
    prefs.value = { ...prefs.value, ...(patch as Partial<DictationPrefs>) };
    return { ...prefs.value };
  },
}));

const transcribe = vi.hoisted(() => ({ advancedStatus: vi.fn(() => ({ server: false, model: undefined, download: { downloading: false, received: 0, total: 0 } })), warmIfAdvanced: vi.fn() }));
vi.mock("@/lib/transcribe", () => ({ advancedStatus: transcribe.advancedStatus, warmIfAdvanced: transcribe.warmIfAdvanced }));

const model = vi.hoisted(() => ({ file: undefined as string | undefined, download: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/whisper-model", () => ({
  serverModel: () => model.file,
  downloadModel: model.download,
  downloadState: () => ({ downloading: false, received: 0, total: 0 }),
}));

const server = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("@/lib/whisper-server", () => ({ stopServer: server.stop }));

const URL_BASE = "http://localhost/api/transcribe/settings";
const WRITE = { host: "localhost", "x-weft-token": "1" };

const patch = (body: Record<string, unknown>, headers: Record<string, string> = WRITE) =>
  PATCH(new Request(URL_BASE, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }));

beforeEach(() => {
  vi.clearAllMocks();
  prefs.value = { ...DEFAULTS };
  prefs.written = [];
  model.file = undefined;
  transcribe.advancedStatus.mockReturnValue({ server: false, model: undefined, download: { downloading: false, received: 0, total: 0 } });
});

describe("GET /api/transcribe/settings", () => {
  it("returns the prefs and the advanced dictation's state", async () => {
    const res = await GET(new Request(URL_BASE, { headers: { host: "localhost" } }));
    expect(await res.json()).toEqual({
      prefs: { language: "system", advanced: false, vocabulary: "" },
      server: false,
      model: undefined,
      download: { downloading: false, received: 0, total: 0 },
    });
  });

  it("refuses a foreign host", async () => {
    const res = await GET(new Request(URL_BASE, { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/transcribe/settings", () => {
  it("saves the language and gives the new view back", async () => {
    const res = await patch({ language: "fr" });
    expect(prefs.written).toEqual([{ language: "fr" }]);
    expect(await res.json()).toMatchObject({ prefs: { language: "fr" } });
  });

  it("saves the vocabulary", async () => {
    await patch({ vocabulary: "Weft, Supabase" });
    expect(prefs.written).toEqual([{ vocabulary: "Weft, Supabase" }]);
  });

  it("stops the server and frees the model when Advanced dictation goes off", async () => {
    await patch({ advanced: false });
    expect(prefs.written).toEqual([{ advanced: false }]);
    expect(server.stop).toHaveBeenCalled();
    expect(transcribe.warmIfAdvanced).not.toHaveBeenCalled();
    expect(model.download).not.toHaveBeenCalled();
  });

  it("warms the server when Advanced dictation goes on and the model is here", async () => {
    model.file = "/models/ggml-large-v3-turbo.bin";
    await patch({ advanced: true });
    expect(prefs.written).toEqual([{ advanced: true }]);
    expect(transcribe.warmIfAdvanced).toHaveBeenCalled();
    expect(model.download).not.toHaveBeenCalled();
    expect(server.stop).not.toHaveBeenCalled();
  });

  it("downloads the model when Advanced dictation goes on and there is none", async () => {
    await patch({ advanced: true });
    expect(model.download).toHaveBeenCalled();
    expect(server.stop).not.toHaveBeenCalled();
  });

  it("warms the server once the model has been downloaded", async () => {
    const order: string[] = [];
    model.download.mockImplementationOnce(() => {
      order.push("download");
      return Promise.resolve();
    });
    transcribe.warmIfAdvanced.mockImplementationOnce(() => {
      order.push("warm");
    });
    await patch({ advanced: true });
    await vi.waitFor(() => expect(transcribe.warmIfAdvanced).toHaveBeenCalled());
    expect(order).toEqual(["download", "warm"]);
  });

  it("is a 400 with the reason when the settings can't be saved", async () => {
    const res = await patch({ language: "klingon" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Dictation can\'t listen for "klingon".' });
  });

  it("refuses a request without the write header", async () => {
    const res = await patch({ language: "fr" }, { host: "localhost" });
    expect(res.status).toBe(403);
    expect(prefs.written).toEqual([]);
  });

  it("refuses a foreign host", async () => {
    const res = await patch({ language: "fr" }, { host: "evil.com", "x-weft-token": "1" });
    expect(res.status).toBe(403);
    expect(prefs.written).toEqual([]);
  });
});
