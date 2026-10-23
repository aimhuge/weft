import { beforeEach, describe, expect, it } from "vitest";
import {
  DESCRIPTION,
  PILLARS,
  REPO,
  SITE,
  _resetLoadHomeCacheForTests,
  downloadLink,
  homeMetadata,
  isDeployed,
  loadHome,
  parseFeed,
} from "./home";

describe("isDeployed", () => {
  it("is true on Vercel or with WEFT_HOME, false otherwise", () => {
    expect(isDeployed({ VERCEL: "1" })).toBe(true);
    expect(isDeployed({ WEFT_HOME: "1" })).toBe(true);
    expect(isDeployed({})).toBe(false);
    expect(isDeployed({ VERCEL: "" })).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(isDeployed()).toBe(Boolean(process.env.VERCEL || process.env.WEFT_HOME));
  });
});

describe("homeMetadata", () => {
  it("names the site, the description and the version", () => {
    const meta = homeMetadata("0.3.0");
    expect(meta.title).toBe("Weft: Engineering the future");
    expect(meta.description).toBe(DESCRIPTION);
    expect(String(meta.metadataBase)).toBe(`${SITE}/`);
    expect(meta.alternates).toEqual({ canonical: "/" });
    expect(meta.openGraph).toMatchObject({ url: SITE, siteName: "Weft", type: "website" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(meta.other).toEqual({ "weft:version": "0.3.0" });
  });
});

describe("parseFeed", () => {
  const dmg = "https://github.com/aimhuge/weft/releases/download/v0.3.0/Weft-0.3.0-arm64.dmg";
  const page = "https://github.com/aimhuge/weft/releases/tag/v0.3.0";

  it("reads the newest release with its dmg and page", () => {
    expect(parseFeed({ releases: [{ version: "0.3.0", dmg, page }] })).toEqual({ version: "0.3.0", dmg, page });
  });

  it("reads the feed the release workflow publishes (currentRelease, download, page at the top)", () => {
    const zip = "https://github.com/aimhuge/weft/releases/download/v0.3.0/Weft-0.3.0-arm64.zip";
    const feed = { currentRelease: "0.3.0", page, download: dmg, releases: [{ version: "0.3.0", updateTo: { version: "0.3.0", url: zip } }] };
    expect(parseFeed(feed)).toEqual({ version: "0.3.0", dmg, page });
    expect(parseFeed({ currentRelease: "0.3.0", download: dmg })).toEqual({ version: "0.3.0", dmg, page: dmg });
  });

  it("falls back to the page when the entry has no dmg", () => {
    expect(parseFeed({ releases: [{ version: "0.3.0", page }] })).toEqual({ version: "0.3.0", dmg: page, page });
  });

  it("skips entries that aren't releases", () => {
    expect(parseFeed({ releases: [null, "x", { version: 3 }, { version: "0.2.0", dmg }] })).toEqual({ version: "0.2.0", dmg, page: dmg });
  });

  it("is null for anything else", () => {
    expect(parseFeed(null)).toBeNull();
    expect(parseFeed("Not Found")).toBeNull();
    expect(parseFeed({})).toBeNull();
    expect(parseFeed({ releases: "no" })).toBeNull();
    expect(parseFeed({ releases: [] })).toBeNull();
    expect(parseFeed({ releases: [{ dmg }] })).toBeNull();
  });
});

describe("downloadLink", () => {
  it("points at the dmg when there is a release", () => {
    const link = downloadLink({ version: "0.3.0", dmg: "https://x/Weft.dmg", page: "https://x/tag" });
    expect(link.label).toBe("Download Weft 0.3.0 for Mac");
    expect(link.href).toBe("https://x/Weft.dmg");
    expect(link.note).toMatch(/Apple silicon/);
  });

  it("points at the repo until the first release", () => {
    const link = downloadLink(null);
    expect(link.href).toBe(REPO);
    expect(link.label).toBe("Get Weft on GitHub");
    expect(link.note).toMatch(/npm run desktop/);
  });
});

describe("loadHome", () => {
  // loadHome caches its first successful import at module scope, so each test must reset it to a clean slate.
  beforeEach(() => _resetLoadHomeCacheForTests());

  // The default export the home page uses today; a function we can recognize.
  const stub = () => null;

  it("resolves the default export of the importer", async () => {
    const result = await loadHome(() => Promise.resolve({ default: stub }));
    expect("Home" in result).toBe(true);
    if ("Home" in result) expect(result.Home).toBe(stub);
  });

  it("caches the resolved component across calls so it imports once", async () => {
    let calls = 0;
    const importer = () => {
      calls += 1;
      return Promise.resolve({ default: stub });
    };
    const a = await loadHome(importer);
    const b = await loadHome(importer);
    expect(calls).toBe(1);
    expect("Home" in a && "Home" in b).toBe(true);
  });

  it("returns an error result with the file and first message line when the import throws", async () => {
    const importer = () => {
      // The shape Next's dev overlay shows for a parse error: a multi-line message that includes the file and a
      // "Parsing ecmascript source code failed" line. We only need the first line and the ./X:Y file pattern.
      return Promise.reject(
        new Error(
          "./components/home/Home.tsx:64:1\nUnexpected token. Did you mean `{'}'}` or `&rbrace;`?\nParsing ecmascript source code failed",
        ),
      );
    };
    const result = await loadHome(importer);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.file).toBe("components/home/Home.tsx");
      expect(result.error.message).toBe("./components/home/Home.tsx:64:1");
    }
  });

  it("returns an error when the module has no default export", async () => {
    const importer = () => Promise.resolve({ default: undefined }) as unknown as Promise<{ default: () => null }>;
    const result = await loadHome(importer);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.message).toMatch(/no default export/);
      expect(result.error.file).toBeNull();
    }
  });
});

describe("PILLARS", () => {
  it("lists the five things Weft stands on, each with a kicker, title and body", () => {
    expect(PILLARS.map((p) => p.kicker)).toEqual(["Code review", "Copilot", "Social", "Connectors", "Vault"]);
    for (const p of PILLARS) expect(p.title && p.body).toBeTruthy();
  });
});
