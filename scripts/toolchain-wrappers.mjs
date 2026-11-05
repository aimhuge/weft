// The toolchain's bin/ wrappers (scripts/bundle-toolchain.mjs writes them), as { fileName: body }.
// Every wrapper but claude and gog runs a script on Weft's own Electron as Node (ELECTRON_RUN_AS_NODE).
//   macOS:   bin/<name>      sh, CONTENTS is Weft.app/Contents, Node is Weft Helper (no second Dock icon)
//   Linux:   bin/<name>      sh, CONTENTS is the unpacked app folder, Node is its `weft` binary
//   Windows: bin/<name>.cmd  batch, the install folder holds Weft.exe and resources\ (the way VS Code's code.cmd works)
// electron/main.cjs appends bin/ to the END of PATH, so a machine's own tools always win.

// The scripts the Node wrappers run, relative to the toolchain folder.
const ON_NODE = {
  node: "",
  npm: "npm/bin/npm-cli.js",
  npx: "npm/bin/npx-cli.js",
  pnpm: "pnpm/bin/pnpm.cjs",
  pnpx: "pnpm/bin/pnpm.cjs dlx",
  "puku-cli": "puku/node_modules/@puku/puku-cli/bin/puku-cli",
};

// The Agent SDK's own Claude Code binary, which the Next server already ships for threads.
export const claudeBinary = (platform, arch) =>
  `server/node_modules/@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${platform === "win32" ? ".exe" : ""}`;

function posixWrappers(platform, arch) {
  const prelude = `#!/bin/sh
# Written by Weft's scripts/bundle-toolchain.mjs.
TOOLCHAIN="$(cd "$(dirname "$0")/.." && pwd)"
CONTENTS="$(cd "$TOOLCHAIN/../.." && pwd)"
`;
  const mac = platform === "darwin";
  const node = mac
    ? `NODE="$CONTENTS/Frameworks/Weft Helper.app/Contents/MacOS/Weft Helper"
[ -x "$NODE" ] || NODE="$CONTENTS/MacOS/Weft"
`
    : `NODE="$CONTENTS/weft"
`;
  const files = {};
  for (const [name, script] of Object.entries(ON_NODE)) {
    const [file, ...rest] = script.split(" ");
    const target = file ? [`"$TOOLCHAIN/${file}"`, ...rest].join(" ") + " " : "";
    files[name] = `${prelude}${node}ELECTRON_RUN_AS_NODE=1 exec "$NODE" ${target}"$@"\n`;
  }
  files.claude = `${prelude}exec "$CONTENTS/${mac ? "Resources" : "resources"}/${claudeBinary(platform, arch)}" "$@"\n`;
  files.gog = `${prelude}exec "$TOOLCHAIN/gog/gog" "$@"\n`;
  return files;
}

// bin → toolchain → resources → the install folder, which holds Weft.exe.
const win = (path) => path.replaceAll("/", "\\");
function windowsWrappers(arch) {
  const prelude = `@echo off\r
rem Written by Weft's scripts/bundle-toolchain.mjs.\r
setlocal\r
set "TOOLCHAIN=%~dp0.."\r
set "APPDIR=%~dp0..\\..\\.."\r
`;
  const files = {};
  for (const [name, script] of Object.entries(ON_NODE)) {
    const [file, ...rest] = script.split(" ");
    const target = file ? [`"%TOOLCHAIN%\\${win(file)}"`, ...rest].join(" ") + " " : "";
    files[`${name}.cmd`] = `${prelude}set ELECTRON_RUN_AS_NODE=1\r\n"%APPDIR%\\Weft.exe" ${target}%*\r\n`;
  }
  files["claude.cmd"] = `${prelude}"%APPDIR%\\resources\\${win(claudeBinary("win32", arch))}" %*\r\n`;
  files["gog.cmd"] = `${prelude}"%TOOLCHAIN%\\gog\\gog.exe" %*\r\n`;
  return files;
}

/** @returns {Record<string, string>} */
export function toolchainWrappers(platform, arch) {
  return platform === "win32" ? windowsWrappers(arch) : posixWrappers(platform, arch);
}
