import { beforeEach, describe, expect, it, vi } from "vitest";

// The Slack drawer's three routes: the settings (GET/PUT), what Slack says to Weft (POST /inbound) and the
// drawer's test message (POST /test). The folders, the settings and the posting are fakes.

vi.mock("next/server", () => ({ connection: async () => {} }));

interface FakeSettings {
  channel: string | null;
  channelName: string;
  folder: string | null;
  links: { folder: string; channel: string; channelName: string | null }[];
  events: { commits: boolean; pushes: boolean; deploys: boolean; status: boolean };
}

interface FakeState {
  folders: string[];
  settings: FakeSettings;
  resolveThrows: boolean;
}

const fake = vi.hoisted((): FakeState => ({
  folders: [],
  settings: { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } },
  resolveThrows: false,
}));

const syncFolders = vi.fn(() => fake.folders);
vi.mock("@/lib/settings", () => ({ syncFolders }));

vi.mock("@/lib/folders", () => ({
  resolveFolder: (raw: string) => {
    if (fake.resolveThrows) throw new Error(`${raw} isn't a folder.`);
    return `/resolved/${raw}`;
  },
}));

const slackStore = vi.hoisted(() => ({
  slackSettings: vi.fn(),
  saveSlackSettings: vi.fn(),
}));
vi.mock("@/lib/slack-store", () => slackStore);

const posted = vi.hoisted(() => ({ calls: [] as { channel: string; message: { text: string }; threadTs?: string }[] }));
vi.mock("@/lib/slack-post", () => ({
  postToSlack: (channel: string, message: { text: string }, threadTs?: string) => {
    posted.calls.push({ channel, message, threadTs });
    return Promise.resolve({ channel: "C1", ts: "1.0" });
  },
}));

const inbound = vi.hoisted(() => ({ handleInbound: vi.fn() }));
vi.mock("@/lib/slack-inbound", () => inbound);

const settings = await import("./slack/route");
const inboundRoute = await import("./slack/inbound/route");
const testRoute = await import("./slack/test/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457", "x-weft-token": "1" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const body = (res: Response) => res.json() as Promise<unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  fake.folders = [];
  fake.resolveThrows = false;
  fake.settings = { channel: "C1", channelName: "general", folder: null, links: [], events: { commits: true, pushes: true, deploys: true, status: true } };
  slackStore.slackSettings.mockImplementation(() => fake.settings);
  slackStore.saveSlackSettings.mockImplementation(() => fake.settings);
  inbound.handleInbound.mockResolvedValue({ kind: "started", cardId: "c1" });
  posted.calls.length = 0;
});

describe("GET /api/slack", () => {
  it("returns the settings and whether the project syncs", async () => {
    const res = await settings.GET(req("/slack", { headers: READ }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ settings: fake.settings, folderSynced: false, synced: [] });
  });

  it("says the project syncs when it does", async () => {
    fake.settings.folder = "/dev/app";
    fake.folders = ["/dev/app"];
    const res = await settings.GET(req("/slack", { headers: READ }));
    expect(await body(res)).toMatchObject({ folderSynced: true });
  });

  it("says the project doesn't sync when it doesn't", async () => {
    fake.settings.folder = "/dev/app";
    const res = await settings.GET(req("/slack", { headers: READ }));
    expect(await body(res)).toMatchObject({ folderSynced: false });
  });

  it("lists the mapped projects that sync", async () => {
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    fake.folders = ["/dev/mapped"];
    const res = await settings.GET(req("/slack", { headers: READ }));
    expect(await body(res)).toMatchObject({ synced: ["/dev/mapped"] });
  });

  it("lists the default and the mapped projects that sync", async () => {
    fake.settings.folder = "/dev/app";
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    fake.folders = ["/dev/app", "/dev/mapped", "/dev/other"];
    const res = await settings.GET(req("/slack", { headers: READ }));
    expect(await body(res)).toMatchObject({ synced: ["/dev/app", "/dev/mapped"] });
  });

  it("returns 403 for a foreign host", async () => {
    const res = await settings.GET(req("/slack", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/slack", () => {
  it("saves the settings it was given", async () => {
    const res = await settings.PUT(req("/slack", { method: "PUT", body: { channel: "C2" } }));
    expect(res.status).toBe(200);
    expect(slackStore.saveSlackSettings).toHaveBeenCalledWith({ channel: "C2" });
  });

  it("resolves the folder it was given", async () => {
    await settings.PUT(req("/slack", { method: "PUT", body: { folder: "app" } }));
    expect(slackStore.saveSlackSettings).toHaveBeenCalledWith({ folder: "/resolved/app" });
  });

  it("clears the folder without resolving it", async () => {
    await settings.PUT(req("/slack", { method: "PUT", body: { folder: null } }));
    expect(slackStore.saveSlackSettings).toHaveBeenCalledWith({ folder: null });
  });

  it("leaves the folder alone when the patch doesn't name one", async () => {
    await settings.PUT(req("/slack", { method: "PUT", body: { channel: "C2" } }));
    expect(slackStore.saveSlackSettings).toHaveBeenCalledWith({ channel: "C2" });
  });

  it("resolves the folder of every link it was given", async () => {
    await settings.PUT(req("/slack", { method: "PUT", body: { links: [{ folder: "app", channel: "C7", channelName: "app" }] } }));
    expect(slackStore.saveSlackSettings).toHaveBeenCalledWith({ links: [{ folder: "/resolved/app", channel: "C7", channelName: "app" }] });
  });

  it("says which projects sync when it saves", async () => {
    fake.settings.folder = "/dev/app";
    fake.settings.links = [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }];
    fake.folders = ["/dev/app", "/dev/mapped"];
    const res = await settings.PUT(req("/slack", { method: "PUT", body: { channel: "C2" } }));
    expect(await body(res)).toMatchObject({ synced: ["/dev/app", "/dev/mapped"] });
  });

  it("returns 400 for a folder that isn't one", async () => {
    fake.resolveThrows = true;
    const res = await settings.PUT(req("/slack", { method: "PUT", body: { folder: "nope" } }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "nope isn't a folder." });
  });

  it("returns 400 for a body that isn't JSON", async () => {
    const res = await settings.PUT(req("/slack", { method: "PUT", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 without the token", async () => {
    const res = await settings.PUT(req("/slack", { method: "PUT", body: { channel: "C2" }, headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/slack/inbound", () => {
  it("passes what Slack said to the handler", async () => {
    const res = await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { kind: "mention", text: "fix it", channel: " C1 ", user: "U1", ts: "1.0", threadTs: "2.0" } }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ kind: "started", cardId: "c1" });
    expect(inbound.handleInbound).toHaveBeenCalledWith({ kind: "mention", text: "fix it", channel: "C1", user: "U1", ts: "1.0", threadTs: "2.0" });
  });

  it("treats anything that isn't a mention as a command", async () => {
    await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { kind: "command", text: "/weft fix it", channel: "C1" } }));
    expect(inbound.handleInbound).toHaveBeenCalledWith(expect.objectContaining({ kind: "command" }));
  });

  it("leaves a timestamp that isn't there undefined", async () => {
    await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { text: "fix it", channel: "C1" } }));
    expect(inbound.handleInbound).toHaveBeenCalledWith(expect.objectContaining({ ts: undefined, threadTs: undefined, user: "" }));
  });

  it("spells out a number it was given", async () => {
    await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { text: 42, channel: "C1", ts: 123 } }));
    expect(inbound.handleInbound).toHaveBeenCalledWith(expect.objectContaining({ text: "42", ts: "123" }));
  });

  it("returns 400 for a message with no channel", async () => {
    const res = await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { text: "fix it", channel: "  " } }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "A Slack message needs its channel." });
  });

  it("returns 400 when the handler fails", async () => {
    inbound.handleInbound.mockRejectedValue(new Error("nope"));
    const res = await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { text: "fix it", channel: "C1" } }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "nope" });
  });

  it("returns 400 for a body that isn't JSON", async () => {
    const res = await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 without the token", async () => {
    const res = await inboundRoute.POST(req("/slack/inbound", { method: "POST", body: { text: "fix it", channel: "C1" }, headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/slack/test", () => {
  it("posts a test message to the channel", async () => {
    const res = await testRoute.POST(req("/slack/test", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ channel: "C1", ts: "1.0" });
    expect(posted.calls).toHaveLength(1);
    expect(posted.calls[0]?.channel).toBe("C1");
    expect(posted.calls[0]?.message.text).toBe("Weft is connected");
  });

  it("returns 400 when no channel is picked", async () => {
    fake.settings.channel = null;
    const res = await testRoute.POST(req("/slack/test", { method: "POST" }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "Pick a channel first." });
  });

  it("returns 403 without the token", async () => {
    const res = await testRoute.POST(req("/slack/test", { method: "POST", headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
  });
});
