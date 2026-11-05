// The model picks on their own (lib/settings-models.ts): one rule for all of them — a model a CLI
// serves, or "" for "no override" — read and written through the same settings file as the rest.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadModels, settingsDir, withSettingsDir } from "./settings.harness";

withSettingsDir();

const saved = () => JSON.parse(fs.readFileSync(path.join(settingsDir.path, "settings.json"), "utf8")) as Record<string, unknown>;

describe("settings: the model picks", () => {
  it("every pick defaults to empty — the card's own model — and is stored as unset", async () => {
    const s = await loadModels();
    expect(s.doneModel()).toBe("");
    expect(s.doneEffort()).toBe("");
    expect(s.copilotModel()).toBe("");
    expect(s.reviewAllModel()).toBe("");
    expect(s.backupModel()).toBe("");
    s.setDoneModel("");
    s.setDoneEffort("");
    s.setCopilotModel("");
    s.setReviewAllModel("");
    s.setBackupModel("");
    const onDisk = saved();
    for (const key of ["doneModel", "doneEffort", "copilotModel", "reviewAllModel", "backupModel"]) {
      expect(key in onDisk).toBe(false);
    }
  });

  it("takes any model a CLI serves, whichever CLI that is", async () => {
    let s = await loadModels();
    s.setDoneModel("claude-opus-5-5");
    s.setCopilotModel("puku-ai-2.8");
    s.setReviewAllModel("openai/gpt-4.1");
    s.setBackupModel("claude-haiku-5-5");
    s = await loadModels();
    expect(s.doneModel()).toBe("claude-opus-5-5");
    expect(s.copilotModel()).toBe("puku-ai-2.8");
    expect(s.reviewAllModel()).toBe("openai/gpt-4.1");
    expect(s.backupModel()).toBe("claude-haiku-5-5");
  });

  it("a saved model no CLI serves reads as empty — a stale hand-edit, not a model the board can't run", async () => {
    fs.writeFileSync(
      path.join(settingsDir.path, "settings.json"),
      JSON.stringify({ doneModel: "gpt-7", copilotModel: "gone-1", reviewAllModel: "gone-2", backupModel: "gone-3" }),
    );
    const s = await loadModels();
    expect(s.doneModel()).toBe("");
    expect(s.copilotModel()).toBe("");
    expect(s.reviewAllModel()).toBe("");
    expect(s.backupModel()).toBe("");
  });

  it("the done effort takes a real effort id and nothing else", async () => {
    let s = await loadModels();
    s.setDoneEffort("xhigh");
    s = await loadModels();
    expect(s.doneEffort()).toBe("xhigh");
    fs.writeFileSync(path.join(settingsDir.path, "settings.json"), JSON.stringify({ doneEffort: "extreme" }));
    expect((await loadModels()).doneEffort()).toBe("");
  });
});
