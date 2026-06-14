import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runAgentLoop, type AgentResult } from "../agent-loop.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import { runTests } from "../verification/test-runner.js";
import type { EvalRunResult, EvalTask, EvalTaskResult } from "./types.js";
import { parseEvalTask } from "./types.js";

export type AgentRunner = (
  userInput: string,
  config: AppConfig,
  tools: ReturnType<typeof createDefaultToolRegistry>
) => Promise<AgentResult>;

export interface EvalRunnerOptions {
  taskId?: string;
  all?: boolean;
  tasksDir?: string;
  resultsDir?: string;
  runner?: AgentRunner;
}

const DEFAULT_TASKS_DIR = path.resolve(process.cwd(), "evals/tasks");
const DEFAULT_RESULTS_DIR = path.resolve(process.cwd(), "evals/results");

export async function runEvalSuite(
  options: EvalRunnerOptions = {}
): Promise<EvalRunResult> {
  const tasksDir = options.tasksDir ?? DEFAULT_TASKS_DIR;
  const resultsDir = options.resultsDir ?? DEFAULT_RESULTS_DIR;
  const tasks = await loadTasks(tasksDir);
  const selectedTasks = selectTasks(tasks, options);
  const startedAt = new Date();
  const runId = formatRunId(startedAt);
  const results: EvalTaskResult[] = [];

  for (const task of selectedTasks) {
    results.push(await runEvalTask(task, options.runner ?? runAgentLoop));
  }

  const runResult: EvalRunResult = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    results,
  };

  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    path.join(resultsDir, `${runId}.json`),
    `${JSON.stringify(runResult, null, 2)}\n`,
    "utf8"
  );

  return runResult;
}

export async function runEvalTask(
  task: EvalTask,
  runner: AgentRunner = runAgentLoop
): Promise<EvalTaskResult> {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), `coding-agent-eval-${task.id}-`)
  );
  const startedAt = Date.now();

  try {
    await writeSetupFiles(tempDir, task);
    const config = loadConfig({
      workingDirectory: tempDir,
      autoApprove: true,
      testCommand: task.testCommand,
    });
    const registry = createDefaultToolRegistry(tempDir);
    const result = await runner(task.prompt, config, registry);
    const failureReason = await evaluateExpectations(tempDir, task, result);
    const retries = Math.max(0, result.toolsCalled.filter(isEditTool).length - 1);

    return {
      task_id: task.id,
      passed: failureReason === undefined,
      turns_used: result.turnsUsed,
      retries,
      wall_time_ms: Date.now() - startedAt,
      failure_reason: failureReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      task_id: task.id,
      passed: false,
      turns_used: 0,
      retries: 0,
      wall_time_ms: Date.now() - startedAt,
      failure_reason: message,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function loadTasks(tasksDir: string): Promise<EvalTask[]> {
  const entries = await readdir(tasksDir);
  const jsonFiles = entries
    .filter((entry) => entry.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
  const tasks: EvalTask[] = [];

  for (const file of jsonFiles) {
    const raw = await readFile(path.join(tasksDir, file), "utf8");
    tasks.push(parseEvalTask(JSON.parse(raw)));
  }

  return tasks;
}

function selectTasks(
  tasks: EvalTask[],
  options: EvalRunnerOptions
): EvalTask[] {
  if (options.taskId !== undefined) {
    const task = tasks.find((candidate) => candidate.id === options.taskId);
    if (task === undefined) {
      throw new Error(`Eval task not found: ${options.taskId}`);
    }
    return [task];
  }

  if (options.all === true) {
    return tasks;
  }

  throw new Error("Specify --task <id> or --all");
}

async function writeSetupFiles(root: string, task: EvalTask): Promise<void> {
  for (const [relativePath, content] of Object.entries(task.setup.files)) {
    const target = resolveEvalPath(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function evaluateExpectations(
  root: string,
  task: EvalTask,
  result: AgentResult
): Promise<string | undefined> {
  if (!result.success) {
    return `agent failed after ${result.turnsUsed} turns`;
  }

  const fileFailure = await evaluateFileExpectations(root, task);
  if (fileFailure !== undefined) return fileFailure;

  const outputFailure = evaluateOutputExpectations(task, result);
  if (outputFailure !== undefined) return outputFailure;

  const testFailure = await evaluateTestExpectation(root, task);
  if (testFailure !== undefined) return testFailure;

  return undefined;
}

async function evaluateFileExpectations(
  root: string,
  task: EvalTask
): Promise<string | undefined> {
  for (const fileExpectation of task.expectations.files ?? []) {
    const target = resolveEvalPath(root, fileExpectation.path);
    let content: string;
    try {
      content = await readFile(target, "utf8");
    } catch {
      return `expected file missing: ${fileExpectation.path}`;
    }

    for (const expected of fileExpectation.contains ?? []) {
      if (!content.includes(expected)) {
        return `expected ${fileExpectation.path} to contain ${expected}`;
      }
    }
  }

  return undefined;
}

function evaluateOutputExpectations(
  task: EvalTask,
  result: AgentResult
): string | undefined {
  for (const expected of task.expectations.outputContains ?? []) {
    if (!result.finalMessage.includes(expected)) {
      return `expected final output to contain ${expected}`;
    }
  }
  return undefined;
}

async function evaluateTestExpectation(
  root: string,
  task: EvalTask
): Promise<string | undefined> {
  if (task.expectations.testsPassing !== true) return undefined;
  if (task.testCommand === undefined) {
    return "testsPassing expectation requires testCommand";
  }

  const result = await runTests(task.testCommand, root);
  if (result.passed) return undefined;

  const detail = result.stderr.trim() || result.stdout.trim();
  return detail === "" ? "expected tests to pass" : detail.slice(0, 500);
}

function resolveEvalPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`eval path escapes temp directory: ${relativePath}`);
  }
  return resolved;
}

function isEditTool(toolName: string): boolean {
  return toolName === "write_file" || toolName === "edit_file";
}

function formatRunId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): EvalRunnerOptions {
  let taskId: string | undefined;
  let all = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--task") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--task requires a value");
      }
      taskId = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown eval argument: ${arg}`);
  }

  return { taskId, all };
}

function printSummary(result: EvalRunResult): void {
  const passed = result.results.filter((item) => item.passed).length;
  console.log(
    `Eval run ${result.run_id}: ${passed}/${result.results.length} passed`
  );
  for (const item of result.results) {
    const status = item.passed ? "PASS" : "FAIL";
    const suffix =
      item.failure_reason === undefined ? "" : ` - ${item.failure_reason}`;
    console.log(`${status} ${item.task_id}${suffix}`);
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  runEvalSuite(parseArgs(process.argv.slice(2)))
    .then(printSummary)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    });
}
