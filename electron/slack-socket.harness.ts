// The fake websocket the Socket Mode tests drive: the test tells it what Slack sends, and reads what
// Weft sent back. Shared by electron/slack-socket*.test.ts.

// A fake websocket: the test tells it what Slack sends, and reads what Weft sent back.
export class FakeSocket {
  static made: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.made.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  // What Slack sends.
  say(message: unknown) {
    this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
  }
}

// The newest socket, and the sockets made so far.
export const last = () => FakeSocket.made[FakeSocket.made.length - 1] as FakeSocket;
export const resetSockets = () => {
  FakeSocket.made = [];
};
