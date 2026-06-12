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

async function runRepl(config: AppConfig, registry: ToolRegistry): Promise<void> {
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
    const shouldContinue = await handleUserInput(line, config, registry);
    if (!shouldContinue) break;
  }

  rl.close();
}

async function main(): Promise<void> {
  const config = loadConfig();
  const registry = createDefaultToolRegistry(config.workingDirectory);
  const initialInput = process.argv.slice(2).join(" ").trim();

  if (initialInput !== "") {
    await handleUserInput(initialInput, config, registry);
    return;
  }

  await runRepl(config, registry);
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
