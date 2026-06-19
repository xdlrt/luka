import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalGateResult, EvalRunResult, EvalSummary } from "./types.js";

export interface EvalThresholds {
  maxAverageTurnsIncreaseRatio: number;
  maxAverageToolCallsIncreaseRatio: number;
  maxFlakyRate: number;
  minFeedbackSuccessRate: number;
}

export interface EvalBaseline {
  schemaVersion: 1;
  createdAt: string;
  model: string;
  thresholds: EvalThresholds;
  summary: EvalSummary;
  tasks: Array<{
    taskId: string;
    passed: boolean;
    turnsUsed: number;
    toolCallCount: number;
    tracePath: string;
  }>;
}

export const DEFAULT_THRESHOLDS: EvalThresholds = {
  maxAverageTurnsIncreaseRatio: 0.25,
  maxAverageToolCallsIncreaseRatio: 0.25,
  maxFlakyRate: 0.1,
  minFeedbackSuccessRate: 0.95,
};

export async function loadBaseline(path: string): Promise<EvalBaseline> {
  return parseBaseline(JSON.parse(await readFile(path, "utf8")));
}

export async function writeBaseline(
  baselinePath: string,
  result: EvalRunResult
): Promise<void> {
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(
    baselinePath,
    `${JSON.stringify(createBaseline(result), null, 2)}\n`,
    "utf8"
  );
}

export function createBaseline(result: EvalRunResult): EvalBaseline {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: result.model,
    thresholds: DEFAULT_THRESHOLDS,
    summary: result.summary,
    tasks: result.results.map((item) => ({
      taskId: item.taskId,
      passed: item.passed,
      turnsUsed: item.turnsUsed,
      toolCallCount: item.toolCalls.length,
      tracePath: item.tracePath,
    })),
  };
}

export function checkRegression(
  result: EvalRunResult,
  baseline: EvalBaseline
): EvalGateResult {
  const failures: string[] = [];
  const thresholds = baseline.thresholds;

  if (result.summary.passRate < baseline.summary.passRate) {
    failures.push(
      `pass rate regressed from ${formatRate(baseline.summary.passRate)} to ${formatRate(result.summary.passRate)}`
    );
  }

  if (
    exceedsRatio(
      result.summary.averageTurns,
      baseline.summary.averageTurns,
      thresholds.maxAverageTurnsIncreaseRatio
    )
  ) {
    failures.push(
      `average turns increased from ${baseline.summary.averageTurns.toFixed(2)} to ${result.summary.averageTurns.toFixed(2)}`
    );
  }

  if (
    exceedsRatio(
      result.summary.averageToolCalls,
      baseline.summary.averageToolCalls,
      thresholds.maxAverageToolCallsIncreaseRatio
    )
  ) {
    failures.push(
      `average tool calls increased from ${baseline.summary.averageToolCalls.toFixed(2)} to ${result.summary.averageToolCalls.toFixed(2)}`
    );
  }

  if (result.summary.flakyRate > thresholds.maxFlakyRate) {
    failures.push(
      `flaky rate ${formatRate(result.summary.flakyRate)} exceeds ${formatRate(thresholds.maxFlakyRate)}`
    );
  }

  for (const task of result.summary.taskStats ?? []) {
    if (task.flaky) {
      failures.push(`flaky task detected: ${task.taskId}`);
    }
  }

  if (
    result.summary.feedbackSuccessRate !== null &&
    result.summary.feedbackSuccessRate < thresholds.minFeedbackSuccessRate
  ) {
    failures.push(
      `feedback success rate ${formatRate(result.summary.feedbackSuccessRate)} is below ${formatRate(thresholds.minFeedbackSuccessRate)}`
    );
  }

  for (const item of result.results) {
    const baselineTask = baseline.tasks.find((task) => task.taskId === item.taskId);
    if (baselineTask?.passed === true && !item.passed) {
      failures.push(`baseline passing task failed: ${item.taskId}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

export function parseBaseline(value: unknown): EvalBaseline {
  const object = asRecord(value, "baseline");
  if (object.schemaVersion !== 1) {
    throw new Error("Invalid baseline schemaVersion: expected 1");
  }
  const thresholds = parseThresholds(object.thresholds);
  const summary = object.summary as EvalSummary;
  const tasksValue = object.tasks;
  if (!Array.isArray(tasksValue)) {
    throw new Error("baseline.tasks must be an array");
  }
  return {
    schemaVersion: 1,
    createdAt: requireString(object, "createdAt"),
    model: requireString(object, "model"),
    thresholds,
    summary,
    tasks: tasksValue.map(parseBaselineTask),
  };
}

function parseThresholds(value: unknown): EvalThresholds {
  const object = asRecord(value, "thresholds");
  return {
    maxAverageTurnsIncreaseRatio: requireNumber(
      object,
      "maxAverageTurnsIncreaseRatio"
    ),
    maxAverageToolCallsIncreaseRatio: requireNumber(
      object,
      "maxAverageToolCallsIncreaseRatio"
    ),
    maxFlakyRate: requireNumber(object, "maxFlakyRate"),
    minFeedbackSuccessRate: requireNumber(object, "minFeedbackSuccessRate"),
  };
}

function parseBaselineTask(value: unknown): EvalBaseline["tasks"][number] {
  const object = asRecord(value, "baseline task");
  return {
    taskId: requireString(object, "taskId"),
    passed: requireBoolean(object, "passed"),
    turnsUsed: requireNumber(object, "turnsUsed"),
    toolCallCount: requireNumber(object, "toolCallCount"),
    tracePath: requireString(object, "tracePath"),
  };
}

function exceedsRatio(current: number, baseline: number, ratio: number): boolean {
  if (baseline <= 0) return current > baseline;
  return current > baseline * (1 + ratio);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
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
