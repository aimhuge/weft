// `weft-worker`'s prompts at the box's terminal (scripts/weft-worker.ts): login's token, forget's confirm.
// Asks for a line without echoing it, so the token doesn't sit on screen or in the terminal's scrollback.
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    let line = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.off("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolve(line.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130);
        line = ch === "\u007f" ? line.slice(0, -1) : line + ch;
      }
    };
    stdin.on("data", onData).resume();
  });
}
