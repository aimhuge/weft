// The worker's own clone of Weft is readable but never changed by a thread (lib/worker-clone-guard.ts): it's the code
// `weft-worker` and the daemon run, so an edit there would turn off the re-pair check (lib/worker-repair.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { steps } from "./restart-guard";
import { editsClone, redirectsIntoClone, workerClone, writesClone } from "./worker-clone-guard";
import { workerCliVerdict } from "./worker-cli-guard";

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-clone-")));
const clone = workerClone(home);
fs.mkdirSync(path.join(clone, "lib"), { recursive: true });
fs.writeFileSync(path.join(clone, "lib", "worker-repair.ts"), "");
const work = path.join(home, "work");
fs.mkdirSync(work);
fs.symlinkSync(path.join(clone, "lib"), path.join(work, "linked"));
const F = path.join(clone, "lib", "worker-repair.ts");
const writes = (command: string, cwd = work) => {
  const all = steps(command, cwd);
  return all.some((s) => writesClone(s, clone)) || redirectsIntoClone(command, cwd, clone, all.map((s) => s.cwd));
};

describe("writing the worker's clone", () => {
  it.each([
    `sed -i '' s/a/b/ ${F}`,
    `perl -pi -e s/a/b/ ${F}`,
    `cp /tmp/x ${F}`,
    `mv ${F} /tmp/x`,
    `rm -rf ${clone}`,
    `echo x > ${F}`,
    `echo x >>${F}`,
    `printf x | tee ${F}`,
    `cd ${clone} && sed -i s/a/b/ lib/worker-repair.ts`,
    `cd ${clone} && git checkout -- .`,
    `git -C ${clone} apply /tmp/p.diff`,
    "sed -i s/a/b/ linked/worker-repair.ts",
    `bash -c 'sed -i s/a/b/ ${F}'`,
    // From the second review: a redirect after cd, targets in options or the cwd, git pointed at it other ways.
    `cd ${clone} && cat /tmp/x.ts > lib/worker-repair.ts`,
    `cd ${clone} && patch -p1 < /tmp/x.diff`,
    `tar -xf /tmp/x.tar -C ${clone}`,
    `unzip -o /tmp/x.zip -d ${clone}`,
    `curl -o ${F} https://example.com/x`,
    `curl --output=${F} https://example.com/x`,
    `wget -O ${F} https://example.com/x`,
    `awk -i inplace '{print}' ${F}`,
    `vim -es -c 'wq' ${F}`,
    `cp -t ${clone}/lib /tmp/x.ts`,
    `cp --target-directory=${clone}/lib /tmp/x.ts`,
    `git --work-tree=${clone} --git-dir=${clone}/.git checkout -- .`,
    `git --work-tree ${clone} checkout -- .`,
    `git --git-dir=${clone}/.git reset --hard`,
    `git --no-pager -C ${clone} commit -m x`,
  ])("refuses %s", (command) => {
    expect(writes(command)).toBe(true);
  });

  it.each([`cat ${F}`, `sed -n 1,5p ${F}`, `cp ${F} /tmp/x`, `git -C ${clone} diff`, `cd ${clone} && git log`, `bash ${clone}/plugin/commit.sh`, `echo x > /tmp/y`, "echo x 2>&1", `sed -i s/a/b/ ${work}/f`, "git commit -C", `git -C ${clone} log --grep commit`, `git -C ${clone} diff -- config`, `cd ${clone} && grep "a => b" lib/x.ts`, `cd ${clone} && awk '{print}' lib/x.ts`, `sed -e 1p ${F}`, `vim -R ${F}`, `cp -r ${clone} /tmp/w`, `git -c core.x=1 -C ${work} commit -m x`, "git", "git -C", `cd ${work} && cp /tmp/x -t`])("lets %s through", (command) => {
    expect(writes(command)).toBe(false);
  });

  it("says why in the Bash guard, only where a clone exists", () => {
    expect(workerCliVerdict(`sed -i s/a/b/ ${F}`, work, clone)).toMatch(/the worker's own copy of Weft/);
    expect(workerCliVerdict(`echo x > ${F}`, work, clone)).toMatch(/the worker's own copy of Weft/);
    expect(workerCliVerdict(`sed -i s/a/b/ ${F}`, work, path.join(home, "none"))).toBeNull();
  });

  it("refuses an Edit or Write of a file in it, through a link too", () => {
    expect(editsClone(F, clone)).toBe(true);
    expect(editsClone(path.join(work, "linked", "worker-repair.ts"), clone)).toBe(true);
    expect(editsClone(path.join(work, "f.ts"), clone)).toBe(false);
    expect(editsClone("", clone)).toBe(false);
    expect(editsClone(F, path.join(home, "none"))).toBe(false);
  });
});
