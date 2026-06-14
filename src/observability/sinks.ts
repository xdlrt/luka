import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "./events.js";

export interface EventSink {
  write(event: AgentEvent): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export interface LocalJsonlSinkOptions {
  directory: string;
  runId: string;
}

export interface FeedbackSinkOptions {
  url: string;
  timeoutMs: number;
  batchSize: number;
  fetchImpl?: typeof fetch;
}

export class LocalJsonlSink implements EventSink {
  private readonly filePath: string;

  constructor(options: LocalJsonlSinkOptions) {
    this.filePath = path.join(options.directory, `${options.runId}.jsonl`);
  }

  get path(): string {
    return this.filePath;
  }

  async write(event: AgentEvent): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

export class HttpFeedbackSink implements EventSink {
  private readonly pending: AgentEvent[] = [];
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FeedbackSinkOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async write(event: AgentEvent): Promise<void> {
    this.pending.push(event);
    if (this.pending.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    await postJson(this.fetchImpl, this.options.url, batch, this.options.timeoutMs);
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; statusText: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return { status: response.status, statusText: response.statusText };
  } finally {
    clearTimeout(timeout);
  }
}
