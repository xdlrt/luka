import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./events.js";
import { summarizeForEvent } from "./events.js";
import { postJson } from "./sinks.js";

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "PermissionRequest",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
}

export interface HttpHook {
  type: "http";
  url: string;
  timeout?: number;
  statusMessage?: string;
}

export type HookCommand = CommandHook | HttpHook;

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HooksSettings {
  hooks: Partial<Record<HookEvent, HookMatcher[]>>;
}

export type HookFailureReporter = (
  event: AgentEvent,
  hook: HookCommand,
  error: Error
) => void;

export type HookEventReporter = (
  type: "HookStart" | "HookEnd",
  payload: Record<string, unknown>
) => void;

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: HookEvent;
  event_id: string;
  agent_event: AgentEvent;
  source?: string;
  reason?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_input_summary?: string;
  tool_response?: unknown;
  tool_response_summary?: string;
}

interface MatchedHook {
  matcher?: string;
  hook: HookCommand;
}

interface CommandHookResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface HookSummary {
  hookEventCount: number;
  hookCommandCount: number;
}

const HOOK_EVENT_SET = new Set<string>(HOOK_EVENTS);
const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;
const DEFAULT_HOOKS_CONFIG_FILE = ".claude/settings.json";

export { DEFAULT_HOOKS_CONFIG_FILE };

export async function loadHookConfig(path: string): Promise<HooksSettings> {
  const raw = await readFile(path, "utf8");
  return parseHookConfig(JSON.parse(raw));
}

export function parseHookConfig(value: unknown): HooksSettings {
  const object = asRecord(value, "hook config");
  const rawHooks = asRecord(object.hooks ?? {}, "hooks");
  const hooks: Partial<Record<HookEvent, HookMatcher[]>> = {};

  for (const [eventType, rawMatchers] of Object.entries(rawHooks)) {
    if (!isHookEvent(eventType)) {
      throw new Error(`Unknown hook event: ${eventType}`);
    }
    if (!Array.isArray(rawMatchers)) {
      throw new Error(`hooks.${eventType} must be an array`);
    }
    hooks[eventType] = rawMatchers.map((matcher, index) =>
      parseHookMatcher(matcher, `hooks.${eventType}[${index}]`)
    );
  }

  return { hooks };
}

export function summarizeHookConfig(config: HooksSettings): HookSummary {
  let hookEventCount = 0;
  let hookCommandCount = 0;
  for (const matchers of Object.values(config.hooks)) {
    if (matchers === undefined || matchers.length === 0) continue;
    hookEventCount += 1;
    for (const matcher of matchers) {
      hookCommandCount += matcher.hooks.length;
    }
  }
  return { hookEventCount, hookCommandCount };
}

export class HookRuntime {
  constructor(
    private readonly config: HooksSettings,
    private readonly options: {
      fetchImpl?: typeof fetch;
      onFailure?: HookFailureReporter;
      onHookEvent?: HookEventReporter;
      sessionId?: string;
      transcriptPath?: string;
      cwd?: string;
    } = {}
  ) {}

  async dispatch(event: AgentEvent): Promise<void> {
    if (!isHookEvent(event.type)) return;
    const hookInput = this.createHookInput(event, event.type);
    const hooks = this.getMatchingHooks(event.type, hookInput);
    for (const { matcher, hook } of hooks) {
      const hookId = randomUUID();
      const startedAt = Date.now();
      this.options.onHookEvent?.("HookStart", {
        hookId,
        hookEventName: event.type,
        hookType: hook.type,
        matcher,
        target: getHookTarget(hook),
        statusMessage: hook.statusMessage,
        sourceEventId: event.id,
      });
      try {
        const result = await runHook(
          hook,
          hookInput,
          this.options.fetchImpl
        );
        this.options.onHookEvent?.("HookEnd", {
          hookId,
          hookEventName: event.type,
          hookType: hook.type,
          matcher,
          target: getHookTarget(hook),
          elapsedMs: Date.now() - startedAt,
          outcome: result.exitCode === undefined || result.exitCode === 0 ? "success" : "error",
          ...result,
        });
        if (result.exitCode !== undefined && result.exitCode !== 0) {
          this.options.onFailure?.(
            event,
            hook,
            new Error(`Hook exited with code ${result.exitCode}`)
          );
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.options.onHookEvent?.("HookEnd", {
          hookId,
          hookEventName: event.type,
          hookType: hook.type,
          matcher,
          target: getHookTarget(hook),
          elapsedMs: Date.now() - startedAt,
          outcome: "error",
          error: summarizeForEvent(error.message),
        });
        this.options.onFailure?.(event, hook, error);
      }
    }
  }

  private getMatchingHooks(
    eventType: HookEvent,
    hookInput: HookInput
  ): MatchedHook[] {
    const matchers = this.config.hooks[eventType] ?? [];
    const query = getMatchQuery(hookInput);
    const matched: MatchedHook[] = [];
    for (const matcher of matchers) {
      if (!matches(matcher.matcher, query)) continue;
      for (const hook of matcher.hooks) {
        matched.push({ matcher: matcher.matcher, hook });
      }
    }
    return matched;
  }

  private createHookInput(event: AgentEvent, hookEventName: HookEvent): HookInput {
    const payload = event.payload;
    const toolName = stringPayload(payload, "toolName");
    return {
      session_id: this.options.sessionId ?? event.runId,
      transcript_path: this.options.transcriptPath ?? "",
      cwd: this.options.cwd ?? "",
      hook_event_name: hookEventName,
      event_id: event.id,
      agent_event: event,
      source: stringPayload(payload, "source"),
      reason: stringPayload(payload, "reason") ?? stringPayload(payload, "finalState"),
      tool_name: toolName,
      tool_input: payload.input,
      tool_input_summary:
        stringPayload(payload, "input") ?? summarizeOptional(payload.input),
      tool_response: payload.result,
      tool_response_summary:
        stringPayload(payload, "result") ?? summarizeOptional(payload.result),
    };
  }
}

async function runHook(
  hook: HookCommand,
  input: HookInput,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const timeoutMs = getHookTimeoutMs(hook);
  if (hook.type === "http") {
    const response = await postJson(fetchImpl, hook.url, input, timeoutMs);
    return {
      httpStatus: response.status,
      httpStatusText: response.statusText,
    };
  }

  const result = await runCommandHook(hook, input, timeoutMs);
  return {
    stdout: summarizeForEvent(result.stdout),
    stderr: summarizeForEvent(result.stderr),
    output: summarizeForEvent(`${result.stdout}${result.stderr}`),
    exitCode: result.exitCode,
    hookJson: parseHookJsonForTrace(result.stdout),
  };
}

function runCommandHook(
  hook: CommandHook,
  input: HookInput,
  timeoutMs: number
): Promise<CommandHookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(hook.command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code });
    });

    child.stdin.end(`${JSON.stringify(input)}\n`, "utf8");
  });
}

function parseHookMatcher(value: unknown, name: string): HookMatcher {
  const object = asRecord(value, name);
  const hooksValue = object.hooks;
  if (!Array.isArray(hooksValue)) {
    throw new Error(`${name}.hooks must be an array`);
  }
  return {
    matcher:
      object.matcher === undefined
        ? undefined
        : requireString(object.matcher, `${name}.matcher`),
    hooks: hooksValue.map((hook, index) =>
      parseHookCommand(hook, `${name}.hooks[${index}]`)
    ),
  };
}

function parseHookCommand(value: unknown, name: string): HookCommand {
  const object = asRecord(value, name);
  const type = object.type;
  const timeout = parseOptionalPositiveNumber(object.timeout, `${name}.timeout`);
  const statusMessage =
    object.statusMessage === undefined
      ? undefined
      : requireString(object.statusMessage, `${name}.statusMessage`);

  if (type === "command") {
    return {
      type,
      command: requireString(object.command, `${name}.command`),
      timeout,
      statusMessage,
    };
  }
  if (type === "http") {
    return {
      type,
      url: requireString(object.url, `${name}.url`),
      timeout,
      statusMessage,
    };
  }
  throw new Error(`${name}.type must be command or http`);
}

function isHookEvent(value: string): value is HookEvent {
  return HOOK_EVENT_SET.has(value);
}

function getHookTimeoutMs(hook: HookCommand): number {
  return Math.round((hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS) * 1000);
}

function getHookTarget(hook: HookCommand): string {
  return hook.type === "http" ? hook.url : hook.command;
}

function getMatchQuery(input: HookInput): string {
  if (
    input.hook_event_name === "PreToolUse" ||
    input.hook_event_name === "PostToolUse" ||
    input.hook_event_name === "PermissionRequest"
  ) {
    return input.tool_name ?? "";
  }
  if (input.hook_event_name === "SessionStart") {
    return input.source ?? "";
  }
  if (input.hook_event_name === "SessionEnd") {
    return input.reason ?? "";
  }
  return input.hook_event_name;
}

function matches(matcher: string | undefined, query: string): boolean {
  return matcher === undefined || matcher === "*" || matcher === query;
}

function parseHookJsonForTrace(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function stringPayload(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function summarizeOptional(value: unknown): string | undefined {
  return value === undefined ? undefined : summarizeForEvent(value);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function parseOptionalPositiveNumber(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}
