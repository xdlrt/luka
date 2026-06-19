import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOT_DIR } from "./brand.js";
import type { AppConfig } from "./config.js";
import type { TodoItem } from "./planning/todo.js";
import type { Message, ToolCall } from "./types.js";

export const SESSION_SCHEMA_VERSION = 1;

export interface SessionConfigSnapshot {
  model: string;
  baseURL: string;
  maxTurns: number;
  autoApprove: boolean;
  testCommand?: string;
  maxRetries: number;
  verbose: boolean;
}

export interface ToolSummary {
  toolName: string;
  content: string;
}

export interface VerificationSummary {
  toolName: string;
  message: string;
}

export interface CompactBoundary {
  turn: number;
  beforeTokens: number;
  afterTokens: number;
  createdAt: string;
}

export interface SessionRecord {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  workingDirectory: string;
  model: string;
  config: SessionConfigSnapshot;
  messages: Message[];
  todos: TodoItem[];
  toolSummaries: ToolSummary[];
  verificationSummaries: VerificationSummary[];
  compactBoundaries: CompactBoundary[];
}

export type SessionCheckpoint = Omit<
  SessionRecord,
  "schemaVersion" | "sessionId" | "createdAt" | "updatedAt" | "workingDirectory" | "model" | "config"
>;

export interface SessionStore {
  save(checkpoint: SessionCheckpoint): Promise<SessionRecord>;
  load(): Promise<SessionRecord>;
  getPath(): string;
}

const SENSITIVE_KEY_PATTERN =
  /(^|_|\b)(ark_api_key|api[-_]?key|authorization|token|password|secret|credential|env)($|_|\b)/i;

export function getSessionPath(
  workingDirectory: string,
  sessionId: string
): string {
  return path.resolve(workingDirectory, DOT_DIR, "sessions", `${sessionId}.json`);
}

export function createConfigSnapshot(config: AppConfig): SessionConfigSnapshot {
  return {
    model: config.model,
    baseURL: config.baseURL,
    maxTurns: config.maxTurns,
    autoApprove: config.autoApprove,
    testCommand: config.testCommand,
    maxRetries: config.maxRetries,
    verbose: config.verbose,
  };
}

export function createSessionStore(
  config: AppConfig,
  sessionId: string,
  existingRecord?: SessionRecord
): SessionStore {
  const sessionPath = getSessionPath(config.workingDirectory, sessionId);
  const createdAt = existingRecord?.createdAt ?? new Date().toISOString();
  const configSnapshot = createConfigSnapshot(config);

  return {
    getPath() {
      return sessionPath;
    },
    async save(checkpoint: SessionCheckpoint): Promise<SessionRecord> {
      const now = new Date().toISOString();
      const record: SessionRecord = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId,
        createdAt,
        updatedAt: now,
        workingDirectory: config.workingDirectory,
        model: config.model,
        config: configSnapshot,
        messages: checkpoint.messages.map(redactMessage),
        todos: checkpoint.todos.map((todo) => ({ ...todo })),
        toolSummaries: checkpoint.toolSummaries.map((item) => ({
          toolName: item.toolName,
          content: redactString(item.content),
        })),
        verificationSummaries: checkpoint.verificationSummaries.map((item) => ({
          toolName: item.toolName,
          message: redactString(item.message),
        })),
        compactBoundaries: checkpoint.compactBoundaries.map((item) => ({
          ...item,
        })),
      };
      await mkdir(path.dirname(sessionPath), { recursive: true });
      await writeFile(sessionPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      return record;
    },
    async load(): Promise<SessionRecord> {
      const raw = await readFile(sessionPath, "utf8");
      return parseSessionRecord(JSON.parse(raw));
    },
  };
}

export async function loadSessionRecord(
  workingDirectory: string,
  sessionId: string
): Promise<SessionRecord> {
  const raw = await readFile(getSessionPath(workingDirectory, sessionId), "utf8");
  return parseSessionRecord(JSON.parse(raw));
}

export function parseSessionRecord(value: unknown): SessionRecord {
  const object = asRecord(value, "session");
  if (object.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error("Invalid session schemaVersion: expected 1");
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: requireString(object, "sessionId"),
    createdAt: requireString(object, "createdAt"),
    updatedAt: requireString(object, "updatedAt"),
    workingDirectory: requireString(object, "workingDirectory"),
    model: requireString(object, "model"),
    config: parseConfigSnapshot(object.config),
    messages: requireArray(object.messages, "messages").map(parseMessage),
    todos: requireArray(object.todos, "todos").map(parseTodo),
    toolSummaries: requireArray(object.toolSummaries, "toolSummaries").map(
      parseToolSummary
    ),
    verificationSummaries: requireArray(
      object.verificationSummaries,
      "verificationSummaries"
    ).map(parseVerificationSummary),
    compactBoundaries: requireArray(
      object.compactBoundaries,
      "compactBoundaries"
    ).map(parseCompactBoundary),
  };
}

function parseConfigSnapshot(value: unknown): SessionConfigSnapshot {
  const object = asRecord(value, "config");
  const snapshot: SessionConfigSnapshot = {
    model: requireString(object, "model"),
    baseURL: requireString(object, "baseURL"),
    maxTurns: requireNumber(object, "maxTurns"),
    autoApprove: requireBoolean(object, "autoApprove"),
    maxRetries: requireNumber(object, "maxRetries"),
    verbose: requireBoolean(object, "verbose"),
  };
  const testCommand = optionalString(object.testCommand, "testCommand");
  if (testCommand !== undefined) snapshot.testCommand = testCommand;
  return snapshot;
}

function parseMessage(value: unknown): Message {
  const object = asRecord(value, "message");
  const role = object.role;
  if (
    role !== "system" &&
    role !== "user" &&
    role !== "assistant" &&
    role !== "tool"
  ) {
    throw new Error("message.role must be system, user, assistant, or tool");
  }
  const content = object.content;
  if (content !== null && typeof content !== "string") {
    throw new Error("message.content must be a string or null");
  }
  const message: Message = { role, content };
  const toolCallId = optionalString(object.tool_call_id, "tool_call_id");
  if (toolCallId !== undefined) message.tool_call_id = toolCallId;
  if (object.tool_calls !== undefined) {
    message.tool_calls = requireArray(object.tool_calls, "tool_calls").map(
      parseToolCall
    );
  }
  return message;
}

function parseToolCall(value: unknown): ToolCall {
  const object = asRecord(value, "tool_call");
  if (object.type !== "function") {
    throw new Error("tool_call.type must be function");
  }
  const fn = asRecord(object.function, "tool_call.function");
  return {
    id: requireString(object, "id"),
    type: "function",
    function: {
      name: requireString(fn, "name"),
      arguments: requireString(fn, "arguments"),
    },
  };
}

function parseTodo(value: unknown): TodoItem {
  const object = asRecord(value, "todo");
  const status = object.status;
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    throw new Error("todo.status must be pending, in_progress, or completed");
  }
  return {
    id: requireString(object, "id"),
    content: requireString(object, "content"),
    status,
  };
}

function parseToolSummary(value: unknown): ToolSummary {
  const object = asRecord(value, "tool summary");
  return {
    toolName: requireString(object, "toolName"),
    content: requireString(object, "content"),
  };
}

function parseVerificationSummary(value: unknown): VerificationSummary {
  const object = asRecord(value, "verification summary");
  return {
    toolName: requireString(object, "toolName"),
    message: requireString(object, "message"),
  };
}

function parseCompactBoundary(value: unknown): CompactBoundary {
  const object = asRecord(value, "compact boundary");
  return {
    turn: requireNumber(object, "turn"),
    beforeTokens: requireNumber(object, "beforeTokens"),
    afterTokens: requireNumber(object, "afterTokens"),
    createdAt: requireString(object, "createdAt"),
  };
}

function redactMessage(message: Message): Message {
  const redacted: Message = {
    role: message.role,
    content: message.content === null ? null : redactString(message.content),
  };
  if (message.tool_call_id !== undefined) redacted.tool_call_id = message.tool_call_id;
  if (message.tool_calls !== undefined) {
    redacted.tool_calls = message.tool_calls.map((call) => ({
      ...call,
      function: {
        name: call.function.name,
        arguments: redactJsonString(call.function.arguments),
      },
    }));
  }
  return redacted;
}

function redactJsonString(value: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(value)));
  } catch {
    return redactString(value);
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(item);
  }
  return result;
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(ARK_API_KEY|api[-_]?key|authorization|token|password|secret)=\S+/gi,
      "$1=[redacted]"
    );
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(object: Record<string, unknown>, key: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function requireBoolean(object: Record<string, unknown>, key: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}
