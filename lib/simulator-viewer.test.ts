import { describe, expect, it } from "vitest";
import { viewerHtml } from "./simulator-viewer";

// The live page itself: what the page's script is handed. The capture and taps run in the pane, so they're
// checked by hand; here it's the values the server bakes in and that none of them can break the script.
const DEV = { id: "SIM-1", name: "iPhone 16", platform: "ios" as const, state: "booted" as const };

describe("viewerHtml's live view", () => {
  it("hands the script the device and the screen's shape", () => {
    const html = viewerHtml(DEV, 1_800_000_000_000, { width: 400, height: 800 });
    expect(html).toContain('ID="SIM-1"');
    expect(html).toContain('NAME="iPhone 16"');
    expect(html).toContain("ASPECT=2,");
    expect(html).toContain("weft.simLive");
  });

  it("has no shape without a size, or with a zero width", () => {
    expect(viewerHtml(DEV, 0)).toContain("ASPECT=0,");
    expect(viewerHtml(DEV, 0, { width: 0, height: 800 })).toContain("ASPECT=0,");
  });

  it("keeps a device name from closing the script tag", () => {
    const html = viewerHtml({ ...DEV, name: "</script><script>alert(1)" }, 0);
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
});
