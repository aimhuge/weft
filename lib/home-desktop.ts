// What the weft.zip home page says about Weft as a desktop (components/home/DesktopScene.tsx, Apps.tsx, Anywhere.tsx):
// the hero, the apps on the desktop and the places it runs. The open-card demo, the board, the game and the source
// keep their words in lib/home-story.ts. Kept apart from the components so lib/home-desktop.test.ts can read them.

export const DESKTOP_HERO = {
  eyebrow: "Weft, for Mac and Windows",
  title: "The ultimate",
  titleEm: "AI desktop.",
  lede:
    "One window where your AI plans, builds, browses, tests and ships, a dozen threads at a time. Claude Code, Codex " +
    "and Puku on a board, each with its own browser, your keys behind Touch ID, and your whole stack a click away.",
};

// The hero's drawn desktop: the rail, a board, an open thread and the pane beside it, with a phone and a Touch ID
// prompt floating over them. Each line the thread says carries the pane scene it lights.
export const SCENE = {
  rail: ["🔐", "🪝", "⏰", "🧩"],
  stack: ["GitHub", "Vercel", "Supabase"],
  cards: [
    { title: "Stripe checkout", state: "Running", live: true },
    { title: "Onboarding emails", state: "Review" },
    { title: "Dark mode", state: "Backlog" },
    { title: "Fix login redirect", state: "Done" },
  ],
  card: "Stripe checkout",
  prompt: "Add Stripe checkout, then try it on a phone.",
  says: ["Built it. Filling the Stripe key from your vault.", "Paid with a test card. Here it is on an iPhone."],
  url: "localhost:3000/checkout",
  vault: { name: "STRIPE_SECRET_KEY", ask: "Fill it in on dashboard.stripe.com?" },
};

// What is on the desktop: one tile per thing your AI can reach from Weft, each an emoji, a name and one line.
export interface DesktopApp {
  icon: string;
  name: string;
  body: string;
}

export const APPS: DesktopApp[] = [
  { icon: "🧵", name: "Threads", body: "Claude Code, Codex and Puku, warm and ready: a reply starts in about two seconds." },
  { icon: "🌐", name: "A browser each", body: "Every thread opens your app, clicks through it and leaves the page on screen." },
  { icon: "🔐", name: "Touch ID vault", body: "Threads fill fields and run commands with your keys, and only learn their names." },
  { icon: "📱", name: "Simulators", body: "iPhone and Android, driven by the thread and live in the pane." },
  { icon: "🪝", name: "Webhooks", body: "Stripe, GitHub and Resend reach your localhost through Weft's relay. No tunnels to set up." },
  { icon: "✉️", name: "Google Workspace", body: "Gmail, Calendar, Drive and Sheets, drafted for you to check and send." },
  { icon: "🔎", name: "Research", body: "Ask a question and get a page that grows a round at a time." },
  { icon: "✍️", name: "Copy-edit", body: "Your draft in an editor, with notes in the margin to apply or dismiss." },
  { icon: "🧩", name: "Mini apps", body: "Keep any page a thread made as an app on your rail." },
  { icon: "🎙️", name: "Dictation", body: "Talk in any app on your Mac. Whisper turns it into text, on device." },
  { icon: "⏰", name: "Crons", body: "Run a thread every morning, with a fresh card each time." },
  { icon: "✦", name: "Copilot", body: "⌃⌥Space from any app. It plans the backlog and runs the board." },
];

// Where the desktop runs: the same board on every screen.
export const ANYWHERE = [
  { icon: "💻", name: "Mac and Windows", body: "The full desktop, with Laptop mode keeping threads at work with the lid shut." },
  { icon: "📱", name: "iPhone", body: "See which cards need you and reply to them from your pocket." },
  { icon: "🌍", name: "weft.zip", body: "The same board in any browser, shared with your team." },
  { icon: "☁️", name: "Weft Workers", body: "A box in the cloud that keeps building while your laptop sleeps." },
];

export const CLOSING = { title: "Give your AI a desktop.", titleEm: "Watch it work." };
