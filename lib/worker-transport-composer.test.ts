// The composer's side of a worker card's transport (lib/worker-transport.ts, H3b): the "/" list from the worker,
// Send later as host verbs the worker holds the timer for, and pasted files saved on this Mac to travel on send.
import { beforeEach, describe, expect, it, vi } from "vitest";

const acts = vi.hoisted(() => ({
  askWorker: vi.fn<(verb: string, args: Record<string, unknown>) => Promise<unknown>>(),
  actOnWorker: vi.fn<(verb: string, args: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve(undefined)),
}));
vi.mock("./worker-acts", () => ({ ...acts, postWorkerAction: vi.fn() }));
const upload = vi.hoisted(() => vi.fn(() => Promise.resolve({ name: "a.png", path: "/att/a.png", url: "u", kind: "image", bytes: 1 })));
vi.mock("./client", () => ({ api: { uploadAttachment: upload } }));

const { SKILLS_FRESH_MS } = await import("./skills-wire");
const { forgetWorkerSkills, workerSkills, workerTransport } = await import("./worker-transport");

const LIST = { ok: true, cardId: "c1", skills: [["deploy", "Ship it", "project"]] };

beforeEach(() => {
  vi.clearAllMocks();
  forgetWorkerSkills();
});

describe("the worker's skills", () => {
  it("asks the worker for the card's list and reads it off the result", async () => {
    acts.askWorker.mockResolvedValue(LIST);
    await expect(workerTransport.listSkills!("c1", "worker://w/app")).resolves.toEqual([{ name: "deploy", description: "Ship it", source: "project" }]);
    expect(acts.askWorker).toHaveBeenCalledWith("skills.list", { id: "c1" });
  });

  it("keeps a card's list for a few minutes, then asks again", async () => {
    acts.askWorker.mockResolvedValue(LIST);
    await workerSkills("c1", 1_000);
    await workerSkills("c1", 1_000 + SKILLS_FRESH_MS - 1);
    expect(acts.askWorker).toHaveBeenCalledTimes(1);
    await workerSkills("c1", 1_000 + SKILLS_FRESH_MS);
    expect(acts.askWorker).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failure, and has nothing to ask without a card", async () => {
    acts.askWorker.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(LIST);
    await expect(workerSkills("c1")).rejects.toThrow("offline");
    await expect(workerSkills("c1")).resolves.toHaveLength(1);
    await expect(workerSkills(undefined)).resolves.toEqual([]);
    expect(acts.askWorker).toHaveBeenCalledTimes(2);
  });
});

describe("Send later and attachments", () => {
  it("schedules and takes back as host verbs", async () => {
    await workerTransport.schedule!("c1", "later", 5_000);
    expect(acts.actOnWorker).toHaveBeenCalledWith("card.schedule", { id: "c1", text: "later", at: 5_000 });
    await workerTransport.unschedule!("c1", "m1");
    expect(acts.actOnWorker).toHaveBeenCalledWith("card.unschedule", { id: "c1", messageId: "m1" });
  });

  it("saves a pasted file on this Mac, for the message to carry to the worker", async () => {
    const file = new Blob(["x"]);
    const progress = vi.fn();
    await expect(workerTransport.upload!(file, "a.png", progress)).resolves.toMatchObject({ path: "/att/a.png" });
    expect(upload).toHaveBeenCalledWith(file, "a.png", progress);
  });
});
