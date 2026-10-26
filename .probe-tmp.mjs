import fs from "node:fs";

const p = "/Users/fotoflo/dev/weft/lib/skill-scan.test.ts";
let src = fs.readFileSync(p, "utf8");

// The bidi override literal on the "finds a bidi override" line.
src = src.replace(/`hello\$\{"\u202E"\}`/, '`hello${RLO}`');
// The two BOM literals.
src = src.replace(/`\uFEFFhello`/, '`${BOM}hello`');
src = src.replace(/`\uFEFFhello\\nthere`/, '`${BOM}hello\\nthere`');

fs.writeFileSync(p, src);
console.log("done");
