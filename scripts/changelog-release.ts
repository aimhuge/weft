// Releases this repo's changelog (lib/changelog.ts) into CHANGELOG.md before a tag (docs/architecture/updates.md):
//   pnpm changelog:release <version>
// Every unreleased entry Weft's threads recorded for this repo, plus lines still typed under Unreleased, become the
// version's section; .github/workflows/release.yml then reads that section for the update notes (scripts/release-feed.mjs).
import { releaseToFile } from "../lib/changelog-release";
import { projectRoot } from "../lib/quality-files";

const version = process.argv[2];
if (!version) {
  console.error("usage: pnpm changelog:release <version>");
  process.exit(1);
}
try {
  const r = releaseToFile(projectRoot(process.cwd()), version);
  console.log(`Wrote ${r.version} into ${r.file}: ${r.entries} entr${r.entries === 1 ? "y" : "ies"}${r.drafts ? ` (${r.drafts} not committed yet)` : ""}.`);
} catch (err) {
  console.error(`changelog:release: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
