import { describe, expect, it } from "vitest";
import {
  checkRegression,
  createBaseline,
  DEFAULT_THRESHOLDS,
} from "../src/evals/baseline.js";
import type { EvalRunResult } from "../src/evals/types.js";

describe("eval baseline", () => {
  it("creates a baseline from a run result", () => {
    const result = createRunResult();

    expect(createBaseline(result)).toMatchObject({
      schemaVersion: 1,
      model: "model-a",
      thresholds: DEFAULT_THRESHOLDS,
      summary: result.summary,
      tasks: [
        {
          taskId: "task-a",
          passed: true,
          turnsUsed: 2,
          toolCallCount: 2,
          tracePath: "trace-a.jsonl",
        },
      ],
    });
  });

  it("passes when metrics do not regress", () => {
    const result = createRunResult();
    const baseline = createBaseline(result);

    expect(checkRegression(result, baseline)).toEqual({
      passed: true,
      failures: [],
    });
  });

  it("fails when outcome and behavior metrics regress", () => {
    const baselineResult = createRunResult();
    const baseline = createBaseline(baselineResult);
    const current = {
      ...baselineResult,
      summary: {
        ...baselineResult.summary,
        passedAttempts: 0,
        passRate: 0,
        averageTurns: 10,
        averageToolCalls: 10,
        flakyRate: 0.5,
        feedbackSuccessRate: 0.5,
      },
      results: [
        {
          ...baselineResult.results[0],
          passed: false,
          failureReason: "failed",
        },
      ],
    };

    const gate = checkRegression(current, baseline);

    expect(gate.passed).toBe(false);
    expect(gate.failures.join("\n")).toContain("pass rate regressed");
    expect(gate.failures.join("\n")).toContain("average turns increased");
    expect(gate.failures.join("\n")).toContain("average tool calls increased");
    expect(gate.failures.join("\n")).toContain("flaky rate");
    expect(gate.failures.join("\n")).toContain("feedback success rate");
    expect(gate.failures.join("\n")).toContain("baseline passing task failed");
  });
});

function createRunResult(): EvalRunResult {
  return {
    runId: "run-a",
    startedAt: "2026-06-14T00:00:00.000Z",
    model: "model-a",
    selection: { mode: "task", value: "task-a" },
    repeat: 1,
    summary: {
      totalAttempts: 1,
      totalTasks: 1,
      passedAttempts: 1,
      passRate: 1,
      averageTurns: 2,
      averageToolCalls: 2,
      permissionDeniedCount: 0,
      verificationRuns: 1,
      flakyTasks: [],
      flakyRate: 0,
      feedbackSuccessRate: null,
    },
    results: [
      {
        taskId: "task-a",
        attempt: 1,
        runId: "trace-run-a",
        tracePath: "trace-a.jsonl",
        passed: true,
        turnsUsed: 2,
        toolCalls: ["read_file", "edit_file"],
        permissionDeniedCount: 0,
        verificationRuns: 1,
        feedbackStatus: "not_configured",
        wallTimeMs: 10,
      },
    ],
  };
}
