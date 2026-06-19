#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { runAgentSession, type AgentRunner } from "./session.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import type { ToolRegistry } from "./tools/index.js";
import { runTui } from "./tui/index.js";

type WriteLine = (line: string) => void;
type TuiRunner = (config: AppConfig, registry: ToolRegistry) => Promise<void>;

/** Parsed command-line options plus the user prompt after agent flags are removed. */
export interface ParsedCliArgs {
  autoApprove: boolean;
  testCommand?: string;
  maxRetries?: number;
  verbose: boolean;
  hooksConfigPath?: string;
  sessionId?: string;
  resumeSessionId?: string;
  initialInput: string;
}

/** Split CLI flags from the user task so runtime options are never sent to the model. */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const promptParts: string[] = [];
  let autoApprove = false;
  let testCommand: string | undefined;
  let maxRetries: number | undefined;
  let verbose = false;
  let hooksConfigPath: string | undefined;
  let sessionId: string | undefined;
  let resumeSessionId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--auto-approve" || arg === "-y") {
      autoApprove = true;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
    if (arg === "--test-command") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--test-command requires a value");
      }
      testCommand = value;
      i += 1;
      continue;
    }
    if (arg === "--max-retries") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--max-retries requires a value");
      }
      maxRetries = parsePositiveInteger(value, "--max-retries");
      i += 1;
      continue;
    }
    if (arg === "--hooks-config") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--hooks-config requires a value");
      }
      hooksConfigPath = value;
      i += 1;
      continue;
    }
    if (arg === "--session") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--session requires a value");
      }
      sessionId = value;
      i += 1;
      continue;
    }
    if (arg === "--resume") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--resume requires a value");
      }
      resumeSessionId = value;
      i += 1;
      continue;
    }
    promptParts.push(arg);
  }

  return {
    autoApprove,
    testCommand,
    maxRetries,
    verbose,
    hooksConfigPath,
    sessionId,
    resumeSessionId,
    initialInput: promptParts.join(" ").trim(),
  };
}

/** Run one CLI/REPL input through the agent and print the resulting user-facing output. */
export async function handleUserInput(
  rawInput: string,
  config: AppConfig,
  registry: ToolRegistry,
  writeLine: WriteLine = console.log,
  runner?: AgentRunner,
  options: { sessionId?: string; resumeSessionId?: string } = {}
): Promise<boolean> {
  const userInput = rawInput.trim();
  if (userInput === "" && options.resumeSessionId === undefined) return true;
  if (userInput === ".exit") return false;

  try {
    const result = await runAgentSession(userInput, config, registry, {
      runner,
      sessionId: options.sessionId,
      resumeSessionId: options.resumeSessionId,
      onCheckpointWarning: writeLine,
    });
    if (result.finalMessage !== "") {
      writeLine(result.finalMessage);
    }
    if (result.todoDisplay !== undefined && result.todoDisplay !== "") {
      writeLine(result.todoDisplay);
    }
    if (result.toolsCalled.length > 0) {
      writeLine(`[CLI] Tools called: ${result.toolsCalled.join(", ")}`);
    }
    if (!result.success) {
      writeLine(`[CLI] Stopped after ${result.turnsUsed} turns`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(`Error: ${message}`);
  }
  return true;
}

/** Return true when the module URL matches the process entrypoint, including npm bin symlinks. */
export function isCliEntrypoint(
  entrypoint: string | undefined,
  moduleUrl: string
): boolean {
  if (entrypoint === undefined) return false;
  try {
    return realpathSync(entrypoint) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return path.resolve(entrypoint) === path.resolve(fileURLToPath(moduleUrl));
  }
}

export async function runCli(
  argv: string[],
  tuiRunner: TuiRunner = runTui
): Promise<void> {
  const args = parseCliArgs(argv);
  const config = loadConfig({
    autoApprove: args.autoApprove,
    testCommand: args.testCommand,
    maxRetries: args.maxRetries,
    verbose: args.verbose,
    hooksConfigPath: args.hooksConfigPath,
  });
  const registry = createDefaultToolRegistry(config.workingDirectory);
  const initialInput = args.initialInput;

  if (initialInput !== "" || args.resumeSessionId !== undefined) {
    await handleUserInput(initialInput, config, registry, console.log, undefined, {
      sessionId: args.sessionId,
      resumeSessionId: args.resumeSessionId,
    });
    return;
  }

  await tuiRunner(config, registry);
}

async function main(): Promise<void> {
  await runCli(process.argv.slice(2));
}

function parsePositiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
