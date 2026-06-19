import { describe, expect, it } from "vitest";
import {
  buildMarkdownReport,
  createDashboardData,
} from "../src/evals/report.js";
import type { EvalRunResult } from "../src/evals/types.js";

describe("eval report", () => {
  it("builds a markdown summary with failures and trace paths", () => {
    const report = buildMarkdownReport(createRunResult());

    expect(report).toContain("# Eval Summary run-a");
    expect(report).toContain("Pass rate: 50.0% (1/2)");
    expect(report).toContain("Feedback success rate: 100.0%");
    expect(report).toContain("Always failed tasks: task-b");
    expect(report).toContain("## Repeat Stability");
    expect(report).toContain("| task-b | 0/1 | 0.0% | no | 2.00 | 0.00 | 1.00 | 0.00 | failed |");
    expect(report).toContain("task-b attempt 1: failed (trace-b.jsonl)");
    expect(report).toContain("| task-a | 1 | PASS | 2 | 1 | trace-a.jsonl |");
  });

  it("builds dashboard data without raw event payloads", () => {
    expect(createDashboardData(createRunResult())).toMatchObject({
      runId: "run-a",
      summary: { totalAttempts: 2 },
      taskStats: [
        { taskId: "task-a", passRate: 1 },
        { taskId: "task-b", alwaysFailed: true },
      ],
      results: [
        { taskId: "task-a", toolCallCount: 1 },
        { taskId: "task-b", failureReason: "failed" },
      ],
    });
  });
});

function createRunResult(): EvalRunResult {
  return {
    runId: "run-a",
    startedAt: "2026-06-14T00:00:00.000Z",
    model: "model-a",
    selection: { mode: "suite", value: "smoke" },
    repeat: 1,
    summary: {
      totalAttempts: 2,
      totalTasks: 2,
      passedAttempts: 1,
      passRate: 0.5,
      averageTurns: 2,
      averageToolCalls: 1,
      permissionDeniedCount: 0,
      verificationRuns: 0,
      flakyTasks: [],
      flakyRate: 0,
      stablePassedTasks: ["task-a"],
      alwaysFailedTasks: ["task-b"],
      taskStats: [
        {
          taskId: "task-a",
          attempts: 1,
          passedAttempts: 1,
          passRate: 1,
          flaky: false,
          alwaysFailed: false,
          averageTurns: 2,
          turnsStdDev: 0,
          averageToolCalls: 1,
          toolCallsStdDev: 0,
          averageWallTimeMs: 10,
          wallTimeStdDev: 0,
          failureReasons: [],
        },
        {
          taskId: "task-b",
          attempts: 1,
          passedAttempts: 0,
          passRate: 0,
          flaky: false,
          alwaysFailed: true,
          averageTurns: 2,
          turnsStdDev: 0,
          averageToolCalls: 1,
          toolCallsStdDev: 0,
          averageWallTimeMs: 10,
          wallTimeStdDev: 0,
          failureReasons: ["failed"],
        },
      ],
      feedbackSuccessRate: 1,
    },
    results: [
      {
        taskId: "task-a",
        attempt: 1,
        runId: "trace-a",
        tracePath: "trace-a.jsonl",
        passed: true,
        turnsUsed: 2,
        toolCalls: ["read_file"],
        permissionDeniedCount: 0,
        verificationRuns: 0,
        feedbackStatus: "ok",
        wallTimeMs: 10,
      },
      {
        taskId: "task-b",
        attempt: 1,
        runId: "trace-b",
        tracePath: "trace-b.jsonl",
        passed: false,
        turnsUsed: 2,
        toolCalls: ["read_file"],
        permissionDeniedCount: 0,
        verificationRuns: 0,
        feedbackStatus: "ok",
        wallTimeMs: 10,
        failureReason: "failed",
      },
    ],
  };
}
