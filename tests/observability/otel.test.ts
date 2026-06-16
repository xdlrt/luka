import { describe, expect, it, vi } from "vitest";
import type { Context, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { OtelTraceSink } from "../../src/observability/otel.js";
import { createAgentEvent } from "../../src/observability/events.js";

describe("OtelTraceSink", () => {
  it("maps session, LLM, tool, verification, and hook events to spans", async () => {
    const tracer = createTracer();
    const provider = {
      forceFlush: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };
    const sink = new OtelTraceSink({
      endpoint: "https://otel.example/v1/traces",
      serviceName: "luka-test",
      timeoutMs: 1000,
      tracer,
      provider,
    });

    await sink.write(createAgentEvent("run-1", "SessionStart", { source: "cli" }));
    await sink.write(createAgentEvent("run-1", "LLMRequest", { turn: 1, model: "m" }));
    await sink.write(createAgentEvent("run-1", "LLMResponse", { turn: 1, toolCallCount: 1 }));
    await sink.write(createAgentEvent("run-1", "PreToolUse", { toolName: "read_file" }));
    await sink.write(createAgentEvent("run-1", "PostToolUse", { toolName: "read_file" }));
    await sink.write(createAgentEvent("run-1", "VerificationStart", { toolName: "edit_file" }));
    await sink.write(createAgentEvent("run-1", "VerificationEnd", { passed: true }));
    await sink.write(createAgentEvent("run-1", "HookStart", { hookId: "hook-1" }));
    await sink.write(createAgentEvent("run-1", "HookEnd", { hookId: "hook-1", outcome: "success" }));
    await sink.write(createAgentEvent("run-1", "Stop", { success: true }));
    await sink.write(createAgentEvent("run-1", "SessionEnd", { success: true }));
    await sink.flush();
    await sink.close();

    expect(tracer.startedSpans.map((span) => span.name)).toEqual([
      "coding_agent.session",
      "coding_agent.llm_request",
      "coding_agent.tool",
      "coding_agent.verification",
      "coding_agent.hook",
    ]);
    expect(tracer.startedSpans.every((span) => span.ended)).toBe(true);
    expect(tracer.startedSpans[0]?.events.map((event) => event.name)).toContain("Stop");
    expect(provider.forceFlush).toHaveBeenCalled();
    expect(provider.shutdown).toHaveBeenCalled();
  });

  it("marks failed spans as errors", async () => {
    const tracer = createTracer();
    const sink = new OtelTraceSink({
      endpoint: "https://otel.example/v1/traces",
      serviceName: "luka-test",
      timeoutMs: 1000,
      tracer,
      provider: {
        forceFlush: vi.fn(async () => {}),
        shutdown: vi.fn(async () => {}),
      },
    });

    await sink.write(createAgentEvent("run-1", "SessionStart"));
    await sink.write(createAgentEvent("run-1", "PreToolUse", { toolName: "write_file" }));
    await sink.write(
      createAgentEvent("run-1", "PostToolUse", {
        toolName: "write_file",
        blocked: true,
        result: "[blocked] unsafe",
      })
    );

    const toolSpan = tracer.startedSpans.find((span) => span.name === "coding_agent.tool");
    expect(toolSpan?.status).toEqual({
      code: 2,
      message: "[blocked] unsafe",
    });
  });
});

interface FakeEvent {
  name: string;
  attributes?: Record<string, unknown>;
}

class FakeSpan implements Span {
  readonly events: FakeEvent[] = [];
  status: unknown;
  ended = false;

  constructor(readonly name: string) {}

  spanContext(): ReturnType<Span["spanContext"]> {
    return {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: 1,
    };
  }

  setAttribute(): this {
    return this;
  }

  setAttributes(): this {
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({ name, attributes });
    return this;
  }

  addLink(): this {
    return this;
  }

  addLinks(): this {
    return this;
  }

  setStatus(status: unknown): this {
    this.status = status;
    return this;
  }

  updateName(): this {
    return this;
  }

  end(): void {
    this.ended = true;
  }

  isRecording(): boolean {
    return true;
  }

  recordException(): void {}
}

function createTracer(): Tracer & { startedSpans: FakeSpan[] } {
  const startedSpans: FakeSpan[] = [];
  return {
    startedSpans,
    startSpan(name: string, _options?: SpanOptions, _context?: Context): Span {
      const span = new FakeSpan(name);
      startedSpans.push(span);
      return span;
    },
    startActiveSpan: (() => {
      throw new Error("startActiveSpan is not used");
    }) as Tracer["startActiveSpan"],
  };
}
