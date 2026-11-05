import { describe, expect, it } from "vitest";
import { prerenderFacts } from "./prerender-check";

// lib/prerender-gate.ts through prerenderFacts, the way lib/prerender-check.ts runs it.
const ungated = (src: string) => prerenderFacts(src, "page.tsx").ungated;
const PAGE = "export default function Page({ params }) { if (!isWebEnabled()) return <NotDeployed />; return <Suspense><Body params={params} /></Suspense>; }";
const meta = (body: string) => `${PAGE}\nexport async function generateMetadata({ params }) { ${body} }`;

describe("ungatedMetadata", () => {
  it("names generateMetadata awaiting params before the page's gate, \"use cache\" or not (the 0.7.1 dmg build)", () => {
    expect(ungated(meta('"use cache"; const { id } = await params; return {};'))).toEqual([{ fn: "generateMetadata", what: "params", gate: "!isWebEnabled()" }]);
    expect(ungated(meta("await (props.searchParams); if (!isWebEnabled()) return {};")).map((u) => u.what)).toEqual(["searchParams"]);
    expect(ungated(`${PAGE}\nexport const generateViewport = async ({ params }) => (await params).x;`)).toEqual([{ fn: "generateViewport", what: "params", gate: "!isWebEnabled()" }]);
  });

  it("follows a same-file helper that's handed params or reads them itself", () => {
    const helpers = "async function preview(p) { await p; }\nasync function deep() { return outer(); }\nasync function outer() { await params; }\nasync function loop() { return loop(); }\ndeclare function bare(): void;";
    expect(ungated(`${meta("return preview(params);")}\n${helpers}`).map((u) => u.what)).toEqual(["params through preview()"]);
    expect(ungated(`${meta("return deep();")}\n${helpers}`).map((u) => u.what)).toEqual(["params through deep()"]);
    expect(ungated(`${meta("loop(); bare(); imported(params); return {};")}\n${helpers}`)).toEqual([]);
  });

  it("lets generateMetadata return on the same gate first (03d0bb60's fix)", () => {
    expect(ungated(meta("if (!isWebEnabled()) return GENERIC; return linkPreview(params);\nasync function linkPreview(p) { await p; }"))).toEqual([]);
    expect(ungated(meta("if ( ! isWebEnabled() ) { log(); return GENERIC; } await params;"))).toEqual([]);
    expect(ungated(meta("if (!isWebEnabled()) log(); await params;"))).toHaveLength(1);
    expect(ungated(meta("if (!other()) return GENERIC; await params;"))).toHaveLength(1);
    expect(ungated(meta("const f = async () => await params; await cookies(); return {};"))).toEqual([]);
  });

  it("needs a page that returns JSX on a gate before any <Suspense>", () => {
    const withPage = (page: string) => ungated(`${page}\nexport async function generateMetadata({ params }) { await params; }`);
    expect(withPage("export default function P() { if (a) { x(); return (<><p /></>); } return <Suspense />; }")).toHaveLength(1);
    expect(withPage("export default function P() { if (a) return (<main>x</main>); return null; }")).toHaveLength(1);
    expect(withPage("export default function P() { const s = <React.Suspense><p /></React.Suspense>; if (a) return <p />; return s; }")).toEqual([]);
    expect(withPage("export default function P() { x(<Suspense />); if (a) return <p />; }")).toEqual([]);
    expect(withPage("export default function P() { if (a) return null; if (b) { x(); } return <p />; }")).toEqual([]);
    expect(withPage("export default () => <p />;")).toEqual([]);
    expect(withPage("const P = 1;\nexport default P;")).toEqual([]);
    expect(ungated("export async function generateMetadata({ params }) { await params; }")).toEqual([]);
    expect(ungated(`${PAGE}\nexport declare function generateMetadata(): void;`)).toEqual([]);
  });
});
