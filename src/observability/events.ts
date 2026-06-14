import { randomUUID } from "node:crypto";

export const AGENT_EVENT_TYPES = [
  "SessionStart",
  "UserPromptSubmit",
  "LLMRequest",
  "LLMResponse",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "VerificationStart",
  "VerificationEnd",
  "Stop",
  "SessionEnd",
  "EvalTaskStart",
  "EvalTaskEnd",
  "HookStart",
  "HookEnd",
  "HookFailure",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent {
  schemaVersion: 1;
  id: string;
  runId: string;
  parentId?: string;
  timestamp: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export interface CreateAgentEventOptions {
  id?: string;
  timestamp?: string;
  parentId?: string;
}

const EVENT_TYPE_SET = new Set<string>(AGENT_EVENT_TYPES);
const MAX_SUMMARY_CHARS = 500;
const SENSITIVE_KEY_PATTERN =
  /(^|_|\b)(ark_api_key|api[-_]?key|authorization|token|password|secret|credential|env)($|_|\b)/i;

export function createAgentEvent(
  runId: string,
  type: AgentEventType,
  payload: Record<string, unknown> = {},
  options: CreateAgentEventOptions = {}
): AgentEvent {
  const event: AgentEvent = {
    schemaVersion: 1,
    id: options.id ?? randomUUID(),
    runId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    type,
    payload: redactEventPayload(payload),
  };

  if (options.parentId !== undefined) {
    event.parentId = options.parentId;
  }

  validateAgentEvent(event);
  return event;
}

export function validateAgentEvent(value: unknown): AgentEvent {
  const event = asRecord(value, "event");
  if (event.schemaVersion !== 1) {
    throw new Error("Invalid event schemaVersion: expected 1");
  }
  const type = event.type;
  if (typeof type !== "string" || !EVENT_TYPE_SET.has(type)) {
    throw new Error(`Unknown event type: ${String(type)}`);
  }
  requireNonEmptyString(event.id, "id");
  requireNonEmptyString(event.runId, "runId");
  requireIsoTimestamp(event.timestamp);
  if (event.parentId !== undefined) {
    requireNonEmptyString(event.parentId, "parentId");
  }
  if (
    typeof event.payload !== "object" ||
    event.payload === null ||
    Array.isArray(event.payload)
  ) {
    throw new Error("payload must be an object");
  }

  const payload = redactEventPayload(event.payload as Record<string, unknown>);
  return {
    schemaVersion: 1,
    id: event.id as string,
    runId: event.runId as string,
    parentId: event.parentId as string | undefined,
    timestamp: event.timestamp as string,
    type: type as AgentEventType,
    payload,
  };
}

export function redactEventPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return redactRecord(payload);
}

export function summarizeForEvent(value: unknown): string {
  if (value === undefined) return "";
  const raw = typeof value === "string" ? value : safeJson(value);
  return truncate(raw);
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] = redactValue(value);
  }
  return redacted;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(truncate(value));
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object" && value !== null) {
    return redactRecord(value as Record<string, unknown>);
  }
  return String(value);
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(ARK_API_KEY|api[-_]?key|token|password|secret)=\S+/gi, "$1=[redacted]");
}

function truncate(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) return value;
  return `${value.slice(0, MAX_SUMMARY_CHARS)}...[truncated]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireIsoTimestamp(value: unknown): void {
  requireNonEmptyString(value, "timestamp");
  const parsed = Date.parse(value as string);
  if (Number.isNaN(parsed)) {
    throw new Error("timestamp must be a valid ISO timestamp");
  }
}
