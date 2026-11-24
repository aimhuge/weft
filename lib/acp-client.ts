import readline from "node:readline";

// A small Agent Client Protocol client: JSON-RPC 2.0, one message per line, over a CLI's stdin and stdout
// (docs/architecture/antigravity.md). Weft is the ACP *client*: it sends initialize, session/new, session/prompt and
// session/cancel, and answers the agent's own requests (session/request_permission). Nothing here knows which agent
// it talks to, so another ACP agent can reuse it.

export type JsonRpcId = number | string;
export type AcpMessage = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };

/** What the agent asked of Weft: answered with the handler's result, or a JSON-RPC error if it throws. */
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => void | Promise<void>;

export class AcpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "AcpError";
  }
}

type Waiter = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class AcpClient {
  private next = 1;
  private readonly waiting = new Map<JsonRpcId, Waiter>();
  private closedWith: Error | undefined;
  // Notifications are handled one at a time, in order: a tool's start must reach the thread before its end.
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: (line: string) => void,
    private readonly onRequest: RequestHandler,
    private readonly onNotification: NotificationHandler,
  ) {}

  /** Reads the agent's stdout until it ends; every pending request fails then with `why`'s answer. */
  async listen(stdout: NodeJS.ReadableStream, why: () => string = () => "The agent's process ended."): Promise<void> {
    const lines = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    for await (const line of lines) this.receive(line);
    lines.close();
    await this.chain;
    this.close(new AcpError(why()));
  }

  /** One line from the agent. A line that isn't a JSON-RPC message is noise and skipped. */
  receive(line: string): void {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const message = parsed as AcpMessage;
    if (message.method && message.id !== undefined) this.answer(message.id, message.method, message.params);
    else if (message.method) this.chain = this.chain.then(() => this.onNotification(message.method as string, message.params)).catch((err: unknown) => console.error("[acp] notification failed:", err));
    // An answer settles in stream order, after the notifications before it: a prompt's answer mustn't overtake the last
    // slices of its reply, nor a session/load's the history it replayed. (A notification handler mustn't await a
    // request, or the two would wait on each other.)
    else if (message.id !== undefined) this.chain = this.chain.then(() => this.settle(message));
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closedWith) this.send({ jsonrpc: "2.0", method, params });
  }

  /** Fails every request still waiting: the process is gone, so no answer is coming. */
  close(error: Error = new AcpError("The agent's process ended.")): void {
    this.closedWith ??= error;
    for (const waiter of this.waiting.values()) waiter.reject(this.closedWith);
    this.waiting.clear();
  }

  private send(message: AcpMessage) {
    try {
      this.write(`${JSON.stringify(message)}\n`);
    } catch (err) {
      this.close(err instanceof Error ? err : new AcpError(String(err)));
    }
  }

  private settle(message: AcpMessage) {
    const waiter = this.waiting.get(message.id as JsonRpcId);
    if (!waiter) return;
    this.waiting.delete(message.id as JsonRpcId);
    if (message.error) waiter.reject(new AcpError(message.error.message ?? "The agent answered with an error.", message.error.code));
    else waiter.resolve(message.result);
  }

  private answer(id: JsonRpcId, method: string, params: unknown) {
    // Started after the notifications before it (the tool row it asks about is drawn first), but kept out of the
    // chain: a permission request can wait on you, and the updates after it mustn't wait with it.
    void this.chain.then(() => this.onRequest(method, params)).then(
      (result) => this.send({ jsonrpc: "2.0", id, result: result ?? null }),
      (err: unknown) => this.send({ jsonrpc: "2.0", id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }),
    );
  }
}

export const ACP_CLIENT_CODE = [AcpClient];
