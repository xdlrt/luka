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
import {
  EventRecorder,
  type EventRecorderLike,
} from "../observability/recorder.js";
import { createObservabilitySinks } from "../session.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import { runTests } from "../verification/test-runner.js";
import { checkRegression, loadBaseline } from "./baseline.js";
import { writeReportFiles } from "./report.js";
import { readTraceSummary } from "./trace-reader.js";
import type {
  EvalRunResult,
  EvalSelectionMode,
  EvalSummary,
  EvalTask,
  EvalTaskResult,
} from "./types.js";
import { parseEvalTask } from "./types.js";

const OBSERVABILITY_FLUSH_TIMEOUT_MS = 500;

export type AgentRunner = (
  userInput: string,
  config: AppConfig,
  tools: ReturnType<typeof createDefaultToolRegistry>,
  recorder?: EventRecorderLike
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

export interface EvalRunnerOptions {
  taskId?: string;
  suite?: string;
  all?: boolean;
  tasksDir?: string;
  suitesDir?: string;
  resultsDir?: string;
  dashboardDir?: string;
  traceDir?: string;
  repeat?: number;
  baselinePath?: string;
  check?: boolean;
  mock?: boolean;
  runner?: AgentRunner;
  createRecorder?: (
    config: AppConfig,
    runId: string,
    tracePath: string
  ) => EventRecorderLike;
}

const DEFAULT_TASKS_DIR = path.resolve(process.cwd(), "evals/tasks");
const DEFAULT_SUITES_DIR = path.resolve(process.cwd(), "evals/suites");
const DEFAULT_RESULTS_DIR = path.resolve(process.cwd(), "evals/results");
const DEFAULT_DASHBOARD_DIR = path.resolve(process.cwd(), "evals/dashboard");

export async function runEvalSuite(
  options: EvalRunnerOptions = {}
): Promise<EvalRunResult> {
  const tasksDir = options.tasksDir ?? DEFAULT_TASKS_DIR;
  const suitesDir = options.suitesDir ?? DEFAULT_SUITES_DIR;
  const resultsDir = options.resultsDir ?? DEFAULT_RESULTS_DIR;
  const dashboardDir = options.dashboardDir ?? DEFAULT_DASHBOARD_DIR;
  const tasks = await loadTasks(tasksDir);
  const selectedTasks = await selectTasks(tasks, suitesDir, options);
  const startedAt = new Date();
  const runId = formatRunId(startedAt);
  const results: EvalTaskResult[] = [];
  const repeat = options.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error("--repeat requires a positive integer");
  }
  const selection = getSelection(options);

  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const task of selectedTasks) {
      const runner =
        options.runner ??
        (options.mock === true ? createMockRunner(task) : defaultAgentRunner);
      results.push(
        await runEvalTask(task, runner, {
          attempt,
          suiteRunId: runId,
          resultsDir,
          traceDir: options.traceDir,
          createRecorder: options.createRecorder,
        })
      );
    }
  }

  let runResult: EvalRunResult = {
    runId,
    startedAt: startedAt.toISOString(),
    model: resolveModel(results, options.mock === true),
    selection,
    repeat,
    summary: summarizeResults(results, selectedTasks.length),
    results,
  };
  if (options.baselinePath !== undefined) {
    const gate = checkRegression(
      runResult,
      await loadBaseline(options.baselinePath)
    );
    runResult = { ...runResult, gate };
    if (options.check === true && !gate.passed) {
      const paths = await writeReportFiles(runResult, { resultsDir, dashboardDir });
      runResult = {
        ...runResult,
        reportPath: paths.reportPath,
        dashboardPath: paths.dashboardPath,
      };
      await writeRunResult(resultsDir, runResult);
      throw new Error(
        `Eval regression check failed: ${gate.failures.join("; ")}. Report: ${paths.reportPath}`
      );
    }
  }
  const paths = await writeReportFiles(runResult, { resultsDir, dashboardDir });
  runResult = { ...runResult, reportPath: paths.reportPath, dashboardPath: paths.dashboardPath };

  await writeRunResult(resultsDir, runResult);

  return runResult;
}

export async function runEvalTask(
  task: EvalTask,
  runner: AgentRunner = defaultAgentRunner,
  options: {
    attempt?: number;
    suiteRunId?: string;
    resultsDir?: string;
    traceDir?: string;
    createRecorder?: (
      config: AppConfig,
      runId: string,
      tracePath: string
    ) => EventRecorderLike;
  } = {}
): Promise<EvalTaskResult> {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), `coding-agent-eval-${task.id}-`)
  );
  const startedAt = Date.now();
  const attempt = options.attempt ?? 1;
  const suiteRunId = options.suiteRunId ?? formatRunId(new Date());
  const resultsDir = options.resultsDir ?? DEFAULT_RESULTS_DIR;
  const traceDirectory =
    options.traceDir ?? path.join(resultsDir, "traces", suiteRunId);
  let recorder: EventRecorderLike | undefined;
  let tracePath = "";

  try {
    await writeSetupFiles(tempDir, task);
    const config = createEvalConfig(task, tempDir, runner);
    const registry = createDefaultToolRegistry(tempDir);
    const probeRecorder = new EventRecorder();
    tracePath = path.join(traceDirectory, `${probeRecorder.runId}.jsonl`);
    recorder = (options.createRecorder ?? createEvalRecorder)(
      config,
      probeRecorder.runId,
      tracePath
    );
    recorder.emit("SessionStart", {
      mode: "eval",
      taskId: task.id,
      attempt,
      workingDirectory: config.workingDirectory,
      model: config.model,
    });
    recorder.emit("EvalTaskStart", {
      taskId: task.id,
      attempt,
      difficulty: task.difficulty,
    });
    const result = await runner(task.prompt, config, registry, recorder);
    const failureReason = await evaluateExpectations(tempDir, task, result);
    recorder.emit("EvalTaskEnd", {
      taskId: task.id,
      attempt,
      passed: failureReason === undefined,
      failureReason,
    });
    recorder.emit("SessionEnd", {
      mode: "eval",
      taskId: task.id,
      success: failureReason === undefined,
    });
    await recorder.flush?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
    await recorder.close?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
    const trace = await readTraceSummary(tracePath);

    return {
      taskId: task.id,
      attempt,
      runId: trace.runId,
      tracePath,
      passed: failureReason === undefined,
      turnsUsed: trace.turnsUsed || result.turnsUsed,
      toolCalls: trace.toolCalls,
      permissionDeniedCount: trace.permissionDeniedCount,
      verificationRuns: trace.verificationRuns,
      feedbackStatus: trace.feedbackStatus,
      wallTimeMs: Date.now() - startedAt,
      failureReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recorder?.flush?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS }).catch(
      () => {}
    );
    await recorder?.close?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS }).catch(
      () => {}
    );
    return {
      taskId: task.id,
      attempt,
      runId: recorder?.runId ?? "",
      tracePath,
      passed: false,
      turnsUsed: 0,
      toolCalls: [],
      permissionDeniedCount: 0,
      verificationRuns: 0,
      feedbackStatus: "not_configured",
      wallTimeMs: Date.now() - startedAt,
      failureReason: message,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createEvalRecorder(
  config: AppConfig,
  runId: string,
  tracePath: string
): EventRecorderLike {
  const { sinks } = createObservabilitySinks(config, runId, {
    localDirectory: path.dirname(tracePath),
  });
  return new EventRecorder({
    runId,
    sinks,
  });
}

function createEvalConfig(
  task: EvalTask,
  workingDirectory: string,
  runner: AgentRunner
): AppConfig {
  if (runner === defaultAgentRunner) {
    return loadConfig({
      workingDirectory,
      autoApprove: true,
      testCommand: task.testCommand,
    });
  }

  return {
    apiKey: "eval-test-key",
    baseURL: "https://eval.invalid",
    model: "eval-test-model",
    maxTurns: 20,
    workingDirectory,
    autoApprove: true,
    testCommand: task.testCommand,
    maxRetries: 3,
    verbose: false,
    observability: {
      localDir: ".coding-agent/observability",
      feedback: {
        enabled: false,
        timeoutMs: 3000,
        batchSize: 20,
      },
      otel: {
        enabled: false,
        serviceName: "coding-agent",
        timeoutMs: 3000,
      },
    },
  };
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

export async function loadSuite(
  suitesDir: string,
  suiteName: string
): Promise<{ name: string; taskIds: string[] }> {
  const raw = await readFile(path.join(suitesDir, `${suiteName}.json`), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("suite must be an object");
  }
  const object = parsed as Record<string, unknown>;
  if (typeof object.name !== "string" || object.name.trim() === "") {
    throw new Error("suite.name must be a non-empty string");
  }
  if (!Array.isArray(object.taskIds)) {
    throw new Error("suite.taskIds must be an array");
  }
  const taskIds = object.taskIds.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`suite.taskIds[${index}] must be a non-empty string`);
    }
    return item;
  });
  return { name: object.name, taskIds };
}

async function selectTasks(
  tasks: EvalTask[],
  suitesDir: string,
  options: EvalRunnerOptions
): Promise<EvalTask[]> {
  const specified = [
    options.taskId !== undefined,
    options.suite !== undefined,
    options.all === true,
  ].filter(Boolean).length;
  if (specified !== 1) {
    throw new Error(
      "Specify exactly one of --task <id>, --suite <name>, or --all"
    );
  }
  if (options.taskId !== undefined) {
    const task = tasks.find((candidate) => candidate.id === options.taskId);
    if (task === undefined) {
      throw new Error(`Eval task not found: ${options.taskId}`);
    }
    return [task];
  }

  if (options.suite !== undefined) {
    const suite = await loadSuite(suitesDir, options.suite);
    return suite.taskIds.map((taskId) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined) {
        throw new Error(`Eval task not found in suite ${suite.name}: ${taskId}`);
      }
      return task;
    });
  }

  if (options.all === true) {
    return tasks;
  }

  throw new Error("unreachable eval selection");
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

function formatRunId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv: string[]): EvalRunnerOptions {
  let taskId: string | undefined;
  let suite: string | undefined;
  let all = false;
  let repeat: number | undefined;
  let baselinePath: string | undefined;
  let check = false;
  let mock = false;

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
    if (arg === "--suite") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--suite requires a value");
      }
      suite = value;
      i += 1;
      continue;
    }
    if (arg === "--repeat") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--repeat requires a value");
      repeat = parsePositiveInteger(value, "--repeat");
      i += 1;
      continue;
    }
    if (arg === "--baseline") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--baseline requires a value");
      }
      baselinePath = value;
      i += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--mock") {
      mock = true;
      continue;
    }
    throw new Error(`Unknown eval argument: ${arg}`);
  }

  return { taskId, suite, all, repeat, baselinePath, check, mock };
}

function printSummary(result: EvalRunResult): void {
  console.log(
    `Eval run ${result.runId}: ${result.summary.passedAttempts}/${result.summary.totalAttempts} passed`
  );
  for (const item of result.results) {
    const status = item.passed ? "PASS" : "FAIL";
    const suffix =
      item.failureReason === undefined ? "" : ` - ${item.failureReason}`;
    console.log(`${status} ${item.taskId} attempt ${item.attempt}${suffix}`);
  }
}

function getSelection(options: EvalRunnerOptions): {
  mode: EvalSelectionMode;
  value?: string;
} {
  if (options.taskId !== undefined) {
    return { mode: "task", value: options.taskId };
  }
  if (options.suite !== undefined) {
    return { mode: "suite", value: options.suite };
  }
  return { mode: "all" };
}

function summarizeResults(
  results: EvalTaskResult[],
  totalTasks: number
): EvalSummary {
  const passedAttempts = results.filter((item) => item.passed).length;
  const totalAttempts = results.length;
  const feedbackConfigured = results.filter(
    (item) => item.feedbackStatus !== "not_configured"
  );
  const feedbackOk = feedbackConfigured.filter(
    (item) => item.feedbackStatus === "ok"
  );
  const taskIds = new Set(results.map((item) => item.taskId));
  const flakyTasks = Array.from(taskIds).filter((taskId) => {
    const attempts = results.filter((item) => item.taskId === taskId);
    return (
      attempts.some((item) => item.passed) &&
      attempts.some((item) => !item.passed)
    );
  });

  return {
    totalAttempts,
    totalTasks,
    passedAttempts,
    passRate: totalAttempts === 0 ? 0 : passedAttempts / totalAttempts,
    averageTurns: average(results.map((item) => item.turnsUsed)),
    averageToolCalls: average(results.map((item) => item.toolCalls.length)),
    permissionDeniedCount: results.reduce(
      (total, item) => total + item.permissionDeniedCount,
      0
    ),
    verificationRuns: results.reduce(
      (total, item) => total + item.verificationRuns,
      0
    ),
    flakyTasks,
    flakyRate: totalTasks === 0 ? 0 : flakyTasks.length / totalTasks,
    feedbackSuccessRate:
      feedbackConfigured.length === 0
        ? null
        : feedbackOk.length / feedbackConfigured.length,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function resolveModel(results: EvalTaskResult[], mock: boolean): string {
  if (mock) return "mock-eval-model";
  return results.length > 0 ? "configured-model" : "unknown";
}

async function writeRunResult(
  resultsDir: string,
  result: EvalRunResult
): Promise<void> {
  await mkdir(resultsDir, { recursive: true });
  await writeFile(
    path.join(resultsDir, `${result.runId}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
}

function createMockRunner(task?: EvalTask): AgentRunner {
  return async (_userInput, config, _tools, recorder) => {
    if (task !== undefined) {
      await satisfyFileExpectations(config.workingDirectory, task);
    }
    recorder?.emit("LLMRequest", {
      turn: 1,
      model: config.model,
      messageCount: 2,
      toolDefinitionCount: 0,
      approxTokens: 10,
    });
    recorder?.emit("LLMResponse", {
      turn: 1,
      model: config.model,
      toolCallCount: 0,
      finishReason: "stop",
      elapsedMs: 1,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    recorder?.emit("Stop", {
      success: true,
      turns: 1,
      finalState: "mock",
      totalTokens: 2,
    });
    return {
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
    };
  };
}

async function satisfyFileExpectations(
  workingDirectory: string,
  task: EvalTask
): Promise<void> {
  for (const expectation of task.expectations.files ?? []) {
    const target = resolveEvalPath(workingDirectory, expectation.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      `${(expectation.contains ?? ["done"]).join("\n")}\n`,
      "utf8"
    );
  }
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
  runEvalSuite(parseArgs(process.argv.slice(2)))
    .then(printSummary)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    });
}
