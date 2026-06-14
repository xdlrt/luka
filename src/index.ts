import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop, type AgentResult } from "./agent-loop.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createDefaultToolRegistry } from "./tools/index.js";
import type { ToolRegistry } from "./tools/index.js";

type WriteLine = (line: string) => void;
type AgentRunner = (
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry
) => Promise<AgentResult>;

export interface ParsedCliArgs {
  autoApprove: boolean;
  testCommand?: string;
  maxRetries?: number;
  verbose: boolean;
  initialInput: string;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const promptParts: string[] = [];
  let autoApprove = false;
  let testCommand: string | undefined;
  let maxRetries: number | undefined;
  let verbose = false;

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
    promptParts.push(arg);
  }

  return {
    autoApprove,
    testCommand,
    maxRetries,
    verbose,
    initialInput: promptParts.join(" ").trim(),
  };
}

export async function handleUserInput(
  rawInput: string,
  config: AppConfig,
  registry: ToolRegistry,
  writeLine: WriteLine = console.log,
  runner: AgentRunner = runAgentLoop
): Promise<boolean> {
  const userInput = rawInput.trim();
  if (userInput === "") return true;
  if (userInput === ".exit") return false;

  try {
    const result = await runner(userInput, config, registry);
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
