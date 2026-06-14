import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop, type AgentResult } from "./agent-loop.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  DEFAULT_HOOKS_CONFIG_FILE,
  HookRuntime,
  loadHookConfig,
} from "./observability/hooks.js";
import { EventRecorder } from "./observability/recorder.js";
import {
  HttpFeedbackSink,
  LocalJsonlSink,
  type EventSink,
} from "./observability/sinks.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import type { ToolRegistry } from "./tools/index.js";

const OBSERVABILITY_FLUSH_TIMEOUT_MS = 500;

type WriteLine = (line: string) => void;
type AgentRunner = (
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  recorder?: EventRecorder
) => Promise<AgentResult>;

const defaultAgentRunner: AgentRunner = (userInput, config, tools, recorder) =>
  runAgentLoop(
    userInput,
    config,
    tools,
    undefined,
    undefined,
    undefined,
    undefined,
    recorder
  );

export interface ParsedCliArgs {
  autoApprove: boolean;
  testCommand?: string;
  maxRetries?: number;
  verbose: boolean;
  hooksConfigPath?: string;
  initialInput: string;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const promptParts: string[] = [];
  let autoApprove = false;
  let testCommand: string | undefined;
  let maxRetries: number | undefined;
  let verbose = false;
  let hooksConfigPath: string | undefined;

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
    promptParts.push(arg);
  }

  return {
    autoApprove,
    testCommand,
    maxRetries,
    verbose,
    hooksConfigPath,
    initialInput: promptParts.join(" ").trim(),
  };
}

export async function handleUserInput(
  rawInput: string,
  config: AppConfig,
  registry: ToolRegistry,
  writeLine: WriteLine = console.log,
  runner: AgentRunner = defaultAgentRunner
): Promise<boolean> {
  const userInput = rawInput.trim();
  if (userInput === "") return true;
  if (userInput === ".exit") return false;

  const recorder = await createEventRecorder(config);
  try {
    recorder.emit("SessionStart", {
      workingDirectory: config.workingDirectory,
      model: config.model,
    });
    recorder.emit("UserPromptSubmit", {
      input: userInput,
      chars: userInput.length,
    });
    const result = await runner(userInput, config, registry, recorder);
    recorder.emit("SessionEnd", {
      success: result.success,
      turnsUsed: result.turnsUsed,
      toolsCalled: result.toolsCalled,
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
    recorder.emit("SessionEnd", {
      success: false,
      error: message,
    });
    writeLine(`Error: ${message}`);
  } finally {
    await recorder.flush?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
    await recorder.close?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
  }
  return true;
}

async function createEventRecorder(config: AppConfig): Promise<EventRecorder> {
  const runId = randomUUID();
  const sinks: EventSink[] = [
    new LocalJsonlSink({
      directory: path.resolve(
        config.workingDirectory,
        config.observability.localDir
      ),
      runId,
    }),
  ];
  if (
    config.observability.feedback.enabled &&
    config.observability.feedback.url !== undefined
  ) {
    sinks.push(
      new HttpFeedbackSink({
        url: config.observability.feedback.url,
        timeoutMs: config.observability.feedback.timeoutMs,
        batchSize: config.observability.feedback.batchSize,
      })
    );
  }

  let hookConfig;
  const hooksConfigPath =
    config.hooksConfigPath ??
    path.resolve(config.workingDirectory, DEFAULT_HOOKS_CONFIG_FILE);
  try {
    hookConfig = await loadHookConfig(hooksConfigPath);
  } catch (error) {
    if (config.hooksConfigPath !== undefined || !isFileMissing(error)) {
      throw error;
    }
  }

  const recorder = new EventRecorder({ runId, sinks });
  if (hookConfig === undefined) return recorder;

  const hookRuntime = new HookRuntime(hookConfig, {
    onFailure: (event, hook, error) =>
      recorder.emitHookFailure(event, hook, error),
  });
  recorder.setHookRuntime(hookRuntime);
  return recorder;
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function runRepl(config: AppConfig): Promise<void> {
  const rl = createInterface({ input, output });
  let running = true;

  rl.on("SIGINT", () => {
    output.write("\n");
    running = false;
    rl.close();
  });

  while (running) {
    let line: string;
    try {
      line = await rl.question("> ");
    } catch {
      break;
    }
    const shouldContinue = await handleUserInput(
      line,
      config,
      createDefaultToolRegistry(config.workingDirectory)
    );
    if (!shouldContinue) break;
  }

  rl.close();
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const config = loadConfig({
    autoApprove: args.autoApprove,
    testCommand: args.testCommand,
    maxRetries: args.maxRetries,
    verbose: args.verbose,
    hooksConfigPath: args.hooksConfigPath,
  });
  const registry = createDefaultToolRegistry(config.workingDirectory);
  const initialInput = args.initialInput;

  if (initialInput !== "") {
    await handleUserInput(initialInput, config, registry);
    return;
  }

  await runRepl(config);
}

function parsePositiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
