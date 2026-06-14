import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentEventType } from "./events.js";
import { createAgentEvent, summarizeForEvent } from "./events.js";
import { HookRuntime, type HookDefinition } from "./hooks.js";
import type { EventSink } from "./sinks.js";

export interface EventRecorderOptions {
  runId?: string;
  sinks?: EventSink[];
  hookRuntime?: HookRuntime;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export interface RecorderDrainOptions {
  timeoutMs?: number;
}

export class EventRecorder {
  readonly runId: string;
  private readonly sinks: EventSink[];
  private hookRuntime: HookRuntime | undefined;
  private readonly stderr: Pick<NodeJS.WriteStream, "write">;
  private readonly queue: AgentEvent[] = [];
  private drainPromise: Promise<void> | undefined;

  constructor(options: EventRecorderOptions = {}) {
    this.runId = options.runId ?? randomUUID();
    this.sinks = options.sinks ?? [];
    this.hookRuntime = options.hookRuntime;
    this.stderr = options.stderr ?? process.stderr;
  }

  setHookRuntime(hookRuntime: HookRuntime): void {
    this.hookRuntime = hookRuntime;
  }

  emit(
    type: AgentEventType,
    payload: Record<string, unknown> = {},
    options: { parentId?: string } = {}
  ): AgentEvent {
    const event = createAgentEvent(this.runId, type, payload, options);
    this.queue.push(event);
    this.startDrain();
    return event;
  }

  emitHookFailure(
    event: AgentEvent,
    hook: HookDefinition,
    error: Error
  ): AgentEvent {
    return this.emit("HookFailure", {
      sourceEventId: event.id,
      sourceEventType: event.type,
      hookType: hook.type,
      target: hook.type === "http" ? hook.url : hook.command,
      error: summarizeForEvent(error.message),
    });
  }

  async flush(options: RecorderDrainOptions = {}): Promise<void> {
    await this.waitForDrain("flush", options.timeoutMs);
    for (const sink of this.sinks) {
      try {
        await sink.flush?.();
      } catch (cause) {
        this.reportSinkError("flush", cause);
      }
    }
  }

  async close(options: RecorderDrainOptions = {}): Promise<void> {
    await this.waitForDrain("close", options.timeoutMs);
    for (const sink of this.sinks) {
      try {
        await sink.close?.();
      } catch (cause) {
        this.reportSinkError("close", cause);
      }
    }
  }

  private startDrain(): void {
    if (this.drainPromise !== undefined) return;
    this.drainPromise = this.drainLoop().finally(() => {
      this.drainPromise = undefined;
      if (this.queue.length > 0) {
        this.startDrain();
      }
    });
  }

  private async drainLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event === undefined) continue;
      await this.write(event);
      if (event.type !== "HookFailure") {
        try {
          await this.hookRuntime?.dispatch(event);
        } catch (cause) {
          this.reportSinkError("hook", cause);
        }
      }
    }
  }

  private async waitForDrain(
    action: string,
    timeoutMs: number | undefined
  ): Promise<void> {
    const pending = this.drainPromise;
    if (pending === undefined) return;
    if (timeoutMs === undefined) {
      await pending;
      return;
    }
    const completed = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), timeoutMs)
      ),
    ]);
    if (!completed) {
      this.stderr.write(
        `[observability] ${action} timed out after ${timeoutMs}ms\n`
      );
    }
  }

  private async write(event: AgentEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.write(event);
      } catch (cause) {
        this.reportSinkError("write", cause);
      }
    }
  }

  private reportSinkError(action: string, cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    this.stderr.write(`[observability] sink ${action} failed: ${message}\n`);
  }
}

export interface EventRecorderLike {
  readonly runId: string;
  emit(
    type: AgentEventType,
    payload?: Record<string, unknown>,
    options?: { parentId?: string }
  ): AgentEvent;
  flush?(options?: RecorderDrainOptions): Promise<void>;
  close?(options?: RecorderDrainOptions): Promise<void>;
}
