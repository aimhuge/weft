// install/worker.sh puts the same pinned cloudflared where lib/tunnel-cloudflared.ts looks for it, so the two must
// name the same release and the same digests.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSETS, VERSION } from "./tunnel-cloudflared";

const script = fs.readFileSync(path.join(process.cwd(), "install/worker.sh"), "utf8");

describe("install/worker.sh's cloudflared", () => {
  it("is the release Weft pins, into the worker's data folder where Weft looks", () => {
    expect(script).toContain(`CLOUDFLARED_VERSION=${VERSION}\n`);
    expect(script).toContain('CLOUDFLARED_BIN="$HOME_DIR/data/bin/cloudflared-$CLOUDFLARED_VERSION"');
  });

  it.each(Object.entries(ASSETS))("checks %s's digest", (_platform, asset) => {
    expect(script).toContain(`file=${asset.file} sha=${asset.sha256} ;;`);
  });
});
