import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalGateResult, EvalRunResult } from "./types.js";

export function buildMarkdownReport(
  result: EvalRunResult,
  gate: EvalGateResult | undefined = result.gate
): string {
  const failed = result.results.filter((item) => !item.passed);
  const lines = [
    `# Eval Summary ${result.runId}`,
    "",
    `- Model: ${result.model}`,
    `- Selection: ${result.selection.mode}${result.selection.value === undefined ? "" : ` ${result.selection.value}`}`,
    `- Repeat: ${result.repeat}`,
    `- Pass rate: ${formatRate(result.summary.passRate)} (${result.summary.passedAttempts}/${result.summary.totalAttempts})`,
    `- Average turns: ${result.summary.averageTurns.toFixed(2)}`,
    `- Average tool calls: ${result.summary.averageToolCalls.toFixed(2)}`,
    `- Permission denied: ${result.summary.permissionDeniedCount}`,
    `- Verification runs: ${result.summary.verificationRuns}`,
    `- Feedback success rate: ${formatNullableRate(result.summary.feedbackSuccessRate)}`,
    `- Flaky tasks: ${result.summary.flakyTasks.length === 0 ? "none" : result.summary.flakyTasks.join(", ")}`,
    "",
    "## Gate",
    "",
  ];

  if (gate === undefined) {
    lines.push("No baseline check was requested.");
  } else if (gate.passed) {
    lines.push("PASS");
  } else {
    lines.push("FAIL");
    lines.push("");
    for (const failure of gate.failures) {
      lines.push(`- ${failure}`);
    }
  }

  lines.push("", "## Failed Tasks", "");
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    for (const item of failed.slice(0, 10)) {
      lines.push(
        `- ${item.taskId} attempt ${item.attempt}: ${item.failureReason ?? "failed"} (${item.tracePath})`
      );
    }
  }

  lines.push("", "## Results", "");
  lines.push("| Task | Attempt | Status | Turns | Tools | Trace |");
  lines.push("| --- | ---: | --- | ---: | ---: | --- |");
  for (const item of result.results) {
    lines.push(
      `| ${item.taskId} | ${item.attempt} | ${item.passed ? "PASS" : "FAIL"} | ${item.turnsUsed} | ${item.toolCalls.length} | ${item.tracePath} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function writeReportFiles(
  result: EvalRunResult,
  options: { resultsDir: string; dashboardDir: string }
): Promise<{ reportPath: string; dashboardPath: string }> {
  const reportPath = path.join(options.resultsDir, "latest-summary.md");
  const dashboardPath = path.join(options.dashboardDir, "data.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(dashboardPath), { recursive: true });
  await writeFile(reportPath, buildMarkdownReport(result), "utf8");
  await writeFile(
    dashboardPath,
    `${JSON.stringify(createDashboardData(result), null, 2)}\n`,
    "utf8"
  );
  return { reportPath, dashboardPath };
}

export function createDashboardData(result: EvalRunResult): Record<string, unknown> {
  return {
    runId: result.runId,
    startedAt: result.startedAt,
    model: result.model,
    selection: result.selection,
    repeat: result.repeat,
    summary: result.summary,
    gate: result.gate,
    results: result.results.map((item) => ({
      taskId: item.taskId,
      attempt: item.attempt,
      passed: item.passed,
      turnsUsed: item.turnsUsed,
      toolCallCount: item.toolCalls.length,
      permissionDeniedCount: item.permissionDeniedCount,
      verificationRuns: item.verificationRuns,
      feedbackStatus: item.feedbackStatus,
      tracePath: item.tracePath,
      failureReason: item.failureReason,
    })),
  };
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullableRate(value: number | null): string {
  return value === null ? "not_configured" : formatRate(value);
}
