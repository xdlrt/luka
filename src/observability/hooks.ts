import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentEventType } from "./events.js";
import { postJson } from "./sinks.js";

export interface CommandHookDefinition {
  type: "command";
  command: string;
  timeoutMs: number;
}

export interface HttpHookDefinition {
  type: "http";
  url: string;
  timeoutMs: number;
}

export type HookDefinition = CommandHookDefinition | HttpHookDefinition;

export interface HookConfig {
  hooks: Partial<Record<AgentEventType, HookDefinition[]>>;
}

export type HookFailureReporter = (
  event: AgentEvent,
  hook: HookDefinition,
  error: Error
) => void;

export const DEFAULT_HOOKS_CONFIG_FILE = "agent-hooks.json";

export async function loadHookConfig(path: string): Promise<HookConfig> {
  const raw = await readFile(path, "utf8");
  return parseHookConfig(JSON.parse(raw));
}

export function parseHookConfig(value: unknown): HookConfig {
  const object = asRecord(value, "hook config");
  const rawHooks = asRecord(object.hooks ?? {}, "hooks");
  const hooks: Partial<Record<AgentEventType, HookDefinition[]>> = {};

  for (const [eventType, rawDefinitions] of Object.entries(rawHooks)) {
    if (!Array.isArray(rawDefinitions)) {
      throw new Error(`hooks.${eventType} must be an array`);
    }
    hooks[eventType as AgentEventType] = rawDefinitions.map((definition, index) =>
      parseHookDefinition(definition, `hooks.${eventType}[${index}]`)
    );
  }

  return { hooks };
}

export class HookRuntime {
  constructor(
    private readonly config: HookConfig,
    private readonly options: {
      fetchImpl?: typeof fetch;
      onFailure?: HookFailureReporter;
    } = {}
  ) {}

  async dispatch(event: AgentEvent): Promise<void> {
    if (event.type === "HookFailure") return;
    const hooks = this.config.hooks[event.type] ?? [];
    for (const hook of hooks) {
      try {
        await runHook(hook, event, this.options.fetchImpl);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.options.onFailure?.(event, hook, error);
      }
    }
  }
}

async function runHook(
  hook: HookDefinition,
  event: AgentEvent,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (hook.type === "http") {
    await postJson(fetchImpl, hook.url, event, hook.timeoutMs);
    return;
  }

  await runCommandHook(hook, event);
}

function runCommandHook(
  hook: CommandHookDefinition,
  event: AgentEvent
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(hook.command, {
      shell: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Hook timed out after ${hook.timeoutMs}ms`));
    }, hook.timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Hook exited with code ${code}: ${stderr.trim()}`));
    });

    child.stdin.end(`${JSON.stringify(event)}\n`, "utf8");
  });
}

function parseHookDefinition(value: unknown, name: string): HookDefinition {
  const object = asRecord(value, name);
  const type = object.type;
  const timeoutMs = parsePositiveInteger(object.timeoutMs, `${name}.timeoutMs`);

  if (type === "command") {
    return {
      type,
      command: requireString(object.command, `${name}.command`),
      timeoutMs,
    };
  }
  if (type === "http") {
    return {
      type,
      url: requireString(object.url, `${name}.url`),
      timeoutMs,
    };
  }
  throw new Error(`${name}.type must be command or http`);
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

function parsePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
