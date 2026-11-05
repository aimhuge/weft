import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /worker.sh", () => {
  it("redirects to the installer on main", () => {
    const res = GET();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://raw.githubusercontent.com/aimhuge/weft/main/install/worker.sh");
  });
});
