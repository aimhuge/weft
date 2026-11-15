import { describe, expect, it } from "vitest";
import { devServerGuard, devServerVerdict, guessUrl, scanLine, startsServer } from "./devserver-guard";

const CWD = "/Users/me/dev/app";
const bash = (command: string, extra: Record<string, unknown> = {}) => devServerVerdict("Bash", { command, ...extra }, CWD);
const w = (s: string) => s.split(" ");

describe("startsServer", () => {
  it.each([
    "next dev",
    "next start -p 3000",
    "vite",
    "vite --port 5173",
    "vite preview",
    "astro dev",
    "nuxi dev",
    "remix dev",
    "expo start",
    "react-native start",
    "react-scripts start",
    "webpack serve",
    "webpack-dev-server",
    "wrangler dev",
    "vercel dev",
    "netlify dev",
    "ng serve",
    "storybook dev",
    "start-storybook",
    "gatsby develop",
    "parcel",
    "parcel index.html",
    "vue-cli-service serve",
    "docusaurus start",
    "nodemon server.js",
    "http-server",
    "live-server",
    "rails s",
    "flask run",
    "uvicorn app:app",
    "hugo server",
    "jekyll serve",
    "npm run dev",
    "npm start",
    "npm run-script serve",
    "pnpm dev",
    "pnpm run dev:web",
    "pnpm --filter web dev",
    "pnpm -C apps/web dev",
    "pnpm exec next dev",
    "yarn start",
    "bun run dev",
    "bun dev",
    "npx next dev",
    "npx -p vite vite",
    "bunx --bun vite",
    "turbo dev",
    "turbo run dev",
    "node node_modules/.bin/next dev",
    "node --inspect node_modules/vite/bin/vite.js",
    "python manage.py runserver",
    "python3.12 ./manage.py runserver 8000",
    "/usr/local/bin/next dev",
  ])("starts a server: %s", (cmd) => expect(startsServer(w(cmd))).toBe(true));

  it.each([
    "next build",
    "next lint",
    "vite build",
    "astro build",
    "expo export",
    "pnpm test",
    "pnpm build",
    "npm run build",
    "npm install",
    "pnpm exec tsc",
    "yarn",
    "npx tsc",
    "turbo build",
    "turbo run build",
    "node script.mjs",
    "python manage.py migrate",
    "python main.py",
    "parcel build index.html",
    "flask db upgrade",
    "git status",
    "next",
    "vite --version",
    "next dev --help",
    "npx vite -v",
    "turbo",
    "turbo run",
    "",
  ])("leaves alone: %s", (cmd) => expect(startsServer(cmd ? w(cmd) : [])).toBe(false));
});

describe("scanLine", () => {
  it("finds a backgrounded dev server and the folder a cd moves it to", () => {
    expect(scanLine("cd web && pnpm dev &", CWD)).toEqual({ detached: true, server: { command: "pnpm dev", cwd: `${CWD}/web` } });
  });

  it("reads `( … ) &`, nohup, setsid, disown and timeout", () => {
    expect(scanLine("(cd web; pnpm dev) &", CWD).detached).toBe(true);
    expect(scanLine("nohup next dev > log 2>&1", CWD)).toMatchObject({ detached: true, server: { command: "next dev" } });
    expect(scanLine("setsid -f vite", CWD)).toMatchObject({ detached: true, server: { command: "vite" } });
    expect(scanLine("pnpm dev & disown", CWD).detached).toBe(true);
    expect(scanLine("timeout 20 pnpm dev", CWD)).toEqual({ detached: false, server: { command: "pnpm dev", cwd: CWD } });
    expect(scanLine("gtimeout -s INT 20 vite", CWD).server?.command).toBe("vite");
  });

  it("reads screen, tmux, pm2, forever and daemonize", () => {
    expect(scanLine("screen -dmS web pnpm dev", CWD)).toMatchObject({ detached: true, server: { command: "pnpm dev" } });
    expect(scanLine("screen -d -m -S web pnpm dev", CWD).server?.command).toBe("pnpm dev");
    expect(scanLine("screen -ls", CWD)).toEqual({ detached: false });
    expect(scanLine("tmux new -d -s web 'pnpm dev'", CWD)).toMatchObject({ detached: true, server: { command: "pnpm dev" } });
    expect(scanLine("tmux new-session -d -s web pnpm dev", CWD).server?.command).toBe("pnpm dev");
    expect(scanLine("tmux ls", CWD)).toEqual({ detached: false });
    expect(scanLine("pm2 start npm -- run dev", CWD)).toMatchObject({ detached: true, server: { command: "npm run dev" } });
    expect(scanLine("pm2 list", CWD)).toEqual({ detached: false });
    expect(scanLine("forever start node_modules/.bin/nodemon", CWD).detached).toBe(true);
    expect(scanLine("forever list", CWD)).toEqual({ detached: false });
    expect(scanLine("daemonize -c /tmp /usr/bin/node node_modules/.bin/next dev", CWD).server?.command).toContain("next dev");
    expect(scanLine("setsid pnpm", CWD)).toEqual({ detached: true });
  });

  it("reads sh -c, heredocs fed to a shell, $( ) and env prefixes", () => {
    expect(scanLine("bash -lc 'pnpm dev &'", CWD)).toMatchObject({ detached: true, server: { command: "pnpm dev" } });
    expect(scanLine("bash <<EOF\nnohup vite &\nEOF", CWD)).toMatchObject({ detached: true, server: { command: "vite" } });
    expect(scanLine("echo $(next dev &)", CWD).detached).toBe(true);
    expect(scanLine("PORT=4002 env FOO=1 pnpm dev &", CWD).server?.command).toBe("pnpm dev");
    expect(scanLine("cd", CWD)).toEqual({ detached: false });
    expect(scanLine("nohup", CWD)).toEqual({ detached: true });
    expect(scanLine("bash -c", CWD)).toEqual({ detached: false });
  });

  it("keeps the first server and stops past five levels of nesting", () => {
    expect(scanLine("vite & next dev &", CWD).server?.command).toBe("vite");
    expect(scanLine("x", CWD, { detached: false }, 6)).toEqual({ detached: false });
  });

  it("tells && and redirects apart from a lone &", () => {
    expect(scanLine("pnpm build && pnpm dev", CWD).detached).toBe(false);
    expect(scanLine("pnpm dev 2>&1 | tee log", CWD).detached).toBe(false);
    expect(scanLine("pnpm dev &> log", CWD).detached).toBe(false);
    expect(scanLine("echo 'a & b'", CWD).detached).toBe(false);
  });
});

describe("guessUrl", () => {
  it.each([
    ["next dev -p 4002", "http://localhost:4002"],
    ["vite --port 5173", "http://localhost:5173"],
    ["vite --port=5174", "http://localhost:5174"],
    ["PORT=8008 pnpm dev", "http://localhost:8008"],
    ["curl localhost:8080", "http://localhost:8080"],
  ])("%s → %s", (cmd, url) => expect(guessUrl(cmd)).toBe(url));
  it("is undefined with no port", () => expect(guessUrl("pnpm dev")).toBeUndefined());
});

describe("devServerVerdict", () => {
  it("refuses a dev server sent to the background and names the devservers call", () => {
    const why = bash("PORT=4002 pnpm dev &");
    expect(why).toContain("mcp__devservers__start");
    expect(why).toContain('command "pnpm dev"');
    expect(why).toContain(`cwd "${CWD}"`);
    expect(why).toContain('url "http://localhost:4002"');
  });

  it("refuses run_in_background, and asks for the url when it can't guess one", () => {
    const why = bash("pnpm dev", { run_in_background: true });
    expect(why).toContain("in the background");
    expect(why).toContain("the url it answers on");
  });

  it("refuses any dev server under Monitor", () => {
    expect(devServerVerdict("Monitor", { command: "pnpm dev 2>&1 | grep --line-buffered Ready" }, CWD)).toContain("under Monitor");
  });

  it("allows a foreground dev server, one-shot commands, background non-servers and no command", () => {
    expect(bash("timeout 20 pnpm dev")).toBeNull();
    expect(bash("next build &")).toBeNull();
    expect(bash("pnpm test", { run_in_background: true })).toBeNull();
    expect(devServerVerdict("Monitor", { command: "tail -f log" }, CWD)).toBeNull();
    expect(devServerVerdict("Monitor", {}, CWD)).toBeNull();
  });
});

describe("devServerGuard", () => {
  const call = (tool_name: string, tool_input: unknown, hook_event_name = "PreToolUse") =>
    devServerGuard({ hook_event_name, tool_name, tool_input, cwd: CWD, session_id: "", transcript_path: "", tool_use_id: "t" } as never, "t", { signal: new AbortController().signal });

  it("denies a backgrounded dev server", async () => {
    const out = (await call("Bash", { command: "nohup next dev &" })) as { hookSpecificOutput: { permissionDecision: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("says nothing otherwise", async () => {
    expect(await call("Bash", { command: "ls" })).toEqual({});
    expect(await call("Bash", undefined)).toEqual({});
    expect(await call("Bash", { command: "nohup next dev &" }, "PostToolUse")).toEqual({});
  });
});
