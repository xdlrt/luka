import { context, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTEL_TRACER_SCOPE } from "../brand.js";
import type { AgentEvent } from "./events.js";
import { summarizeForEvent } from "./events.js";
import type { EventSink } from "./sinks.js";

export interface OtelTraceSinkOptions {
  endpoint: string;
  serviceName: string;
  timeoutMs: number;
  exporter?: SpanExporter;
  tracer?: Tracer;
  provider?: Pick<BasicTracerProvider, "forceFlush" | "shutdown">;
}

interface SpanEntry {
  span: Span;
}

export class OtelTraceSink implements EventSink {
  private readonly provider: Pick<BasicTracerProvider, "forceFlush" | "shutdown">;
  private readonly tracer: Tracer;
  private session: SpanEntry | undefined;
  private readonly llmSpans = new Map<number, SpanEntry>();
  private readonly toolSpans: SpanEntry[] = [];
  private readonly verificationSpans: SpanEntry[] = [];
  private readonly hookSpans = new Map<string, SpanEntry>();

  constructor(options: OtelTraceSinkOptions) {
    if (options.tracer !== undefined && options.provider !== undefined) {
      this.tracer = options.tracer;
      this.provider = options.provider;
      return;
    }

    const exporter =
      options.exporter ??
      new OTLPTraceExporter({
        url: options.endpoint,
        timeoutMillis: options.timeoutMs,
      });
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
      }),
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          exportTimeoutMillis: options.timeoutMs,
        }),
      ],
      forceFlushTimeoutMillis: options.timeoutMs,
    });
    this.provider = provider;
    this.tracer = provider.getTracer(OTEL_TRACER_SCOPE, "1.0.0");
  }

  async write(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "SessionStart":
        this.startSession(event);
        break;
      case "SessionEnd":
        this.addSessionEvent(event);
        this.endSession(event);
        break;
      case "LLMRequest":
        this.startLlm(event);
        break;
      case "LLMResponse":
        this.endLlm(event);
        break;
      case "PreToolUse":
        this.startTool(event);
        break;
      case "PostToolUse":
        this.endTool(event);
        break;
      case "VerificationStart":
        this.startVerification(event);
        break;
      case "VerificationEnd":
        this.endVerification(event);
        break;
      case "HookStart":
        this.startHook(event);
        break;
      case "HookEnd":
        this.endHook(event);
        break;
      default:
        this.addSessionEvent(event);
        break;
    }
  }

  async flush(): Promise<void> {
    await this.provider.forceFlush();
  }

  async close(): Promise<void> {
    this.closeOpenSpans();
    await this.provider.forceFlush();
    await this.provider.shutdown();
  }

  private startSession(event: AgentEvent): void {
    if (this.session !== undefined) {
      this.endSpan(this.session, event);
    }
    const span = this.tracer.startSpan("coding_agent.session", {
      attributes: eventAttributes(event),
      startTime: toTimeInput(event.timestamp),
    });
    this.session = { span };
  }

  private endSession(event: AgentEvent): void {
    if (this.session === undefined) return;
    const session = this.session;
    this.session = undefined;
    this.endSpan(session, event);
  }

  private startLlm(event: AgentEvent): void {
    const turn = numberPayload(event, "turn");
    if (turn === undefined) {
      this.addSessionEvent(event);
      return;
    }
    const span = this.startChildSpan("coding_agent.llm_request", event);
    this.llmSpans.set(turn, { span });
  }

  private endLlm(event: AgentEvent): void {
    const turn = numberPayload(event, "turn");
    const entry = turn === undefined ? undefined : this.llmSpans.get(turn);
    if (entry === undefined || turn === undefined) {
      this.addSessionEvent(event);
      return;
    }
    this.llmSpans.delete(turn);
    this.endSpan(entry, event);
  }

  private startTool(event: AgentEvent): void {
    this.toolSpans.push({ span: this.startChildSpan("coding_agent.tool", event) });
  }

  private endTool(event: AgentEvent): void {
    const entry = this.toolSpans.shift();
    if (entry === undefined) {
      this.addSessionEvent(event);
      return;
    }
    this.endSpan(entry, event);
  }

  private startVerification(event: AgentEvent): void {
    this.verificationSpans.push({
      span: this.startChildSpan("coding_agent.verification", event),
    });
  }

  private endVerification(event: AgentEvent): void {
    const entry = this.verificationSpans.shift();
    if (entry === undefined) {
      this.addSessionEvent(event);
      return;
    }
    this.endSpan(entry, event);
  }

  private startHook(event: AgentEvent): void {
    const hookId = stringPayload(event, "hookId");
    if (hookId === undefined) {
      this.addSessionEvent(event);
      return;
    }
    this.hookSpans.set(hookId, {
      span: this.startChildSpan("coding_agent.hook", event),
    });
  }

  private endHook(event: AgentEvent): void {
    const hookId = stringPayload(event, "hookId");
    const entry = hookId === undefined ? undefined : this.hookSpans.get(hookId);
    if (entry === undefined || hookId === undefined) {
      this.addSessionEvent(event);
      return;
    }
    this.hookSpans.delete(hookId);
    this.endSpan(entry, event);
  }

  private startChildSpan(name: string, event: AgentEvent): Span {
    const parentContext =
      this.session === undefined
        ? context.active()
        : trace.setSpan(context.active(), this.session.span);
    return this.tracer.startSpan(
      name,
      {
        attributes: eventAttributes(event),
        startTime: toTimeInput(event.timestamp),
      },
      parentContext
    );
  }

  private addSessionEvent(event: AgentEvent): void {
    this.session?.span.addEvent(event.type, eventAttributes(event), toTimeInput(event.timestamp));
  }

  private endSpan(entry: SpanEntry, event: AgentEvent): void {
    entry.span.addEvent(event.type, eventAttributes(event), toTimeInput(event.timestamp));
    if (isErrorEvent(event)) {
      entry.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage(event),
      });
    } else {
      entry.span.setStatus({ code: SpanStatusCode.OK });
    }
    entry.span.end(toTimeInput(event.timestamp));
  }

  private closeOpenSpans(): void {
    for (const entry of this.llmSpans.values()) entry.span.end();
    this.llmSpans.clear();
    for (const entry of this.toolSpans.splice(0)) entry.span.end();
    for (const entry of this.verificationSpans.splice(0)) entry.span.end();
    for (const entry of this.hookSpans.values()) entry.span.end();
    this.hookSpans.clear();
    if (this.session !== undefined) {
      this.session.span.end();
      this.session = undefined;
    }
  }
}

function eventAttributes(event: AgentEvent): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    "agent.event.id": event.id,
    "agent.run.id": event.runId,
    "agent.event.type": event.type,
  };
  if (event.parentId !== undefined) {
    attributes["agent.event.parent_id"] = event.parentId;
  }

  for (const [key, value] of Object.entries(event.payload)) {
    const attribute = toAttributeValue(value);
    if (attribute !== undefined) {
      attributes[`agent.payload.${key}`] = attribute;
    }
  }
  return attributes;
}

function toAttributeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) return undefined;
  return summarizeForEvent(value);
}

function toTimeInput(timestamp: string): number {
  return Date.parse(timestamp);
}

function isErrorEvent(event: AgentEvent): boolean {
  const payload = event.payload;
  if (payload.success === false) return true;
  if (payload.passed === false) return true;
  if (payload.error !== undefined) return true;
  if (payload.blocked === true) return true;
  if (payload.approved === false) return true;
  return payload.outcome === "error";
}

function errorMessage(event: AgentEvent): string {
  const payload = event.payload;
  const value =
    payload.error ??
    payload.reason ??
    payload.failureReason ??
    payload.result ??
    payload.outcome;
  return summarizeForEvent(value);
}

function numberPayload(event: AgentEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" ? value : undefined;
}

function stringPayload(event: AgentEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}
