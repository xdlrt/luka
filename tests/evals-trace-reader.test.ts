import { describe, expect, it } from "vitest";
import { createAgentEvent } from "../src/observability/events.js";
import {
  parseTraceEvents,
  summarizeTraceEvents,
} from "../src/evals/trace-reader.js";

describe("trace reader", () => {
  it("summarizes eval metrics from trace events", () => {
    const events = [
      createAgentEvent("run-1", "LLMResponse", { turn: 1 }),
      createAgentEvent("run-1", "PreToolUse", { toolName: "read_file" }),
      createAgentEvent("run-1", "PreToolUse", { toolName: "edit_file" }),
      createAgentEvent("run-1", "PermissionRequest", { approved: false }),
      createAgentEvent("run-1", "VerificationEnd", { passed: true }),
      createAgentEvent("run-1", "EvalTaskEnd", { passed: true }),
      createAgentEvent("run-1", "Stop", {
        success: true,
        finalState: "no_tool_calls",
      }),
    ];

    expect(summarizeTraceEvents(events)).toEqual({
      runId: "run-1",
      turnsUsed: 1,
      toolCalls: ["read_file", "edit_file"],
      permissionDeniedCount: 1,
      verificationRuns: 1,
      feedbackStatus: "not_configured",
      stopSuccess: true,
      stopState: "no_tool_calls",
      evalPassed: true,
      evalFailureReason: undefined,
    });
  });

  it("marks hook failures as failed feedback", () => {
    const events = [
      createAgentEvent("run-1", "HookFailure"),
      createAgentEvent("run-1", "Stop", { success: true }),
    ];

    expect(summarizeTraceEvents(events).feedbackStatus).toBe("failed");
  });

  it("rejects empty traces and invalid JSON lines", () => {
    expect(() => parseTraceEvents("")).toThrow(/trace is empty/);
    expect(() => parseTraceEvents("{bad")).toThrow(/Invalid trace JSON/);
  });

  it("requires a Stop event", () => {
    expect(() =>
      summarizeTraceEvents([createAgentEvent("run-1", "LLMResponse")])
    ).toThrow(/missing Stop/);
  });

  it("rejects traces with multiple run ids", () => {
    expect(() =>
      summarizeTraceEvents([
        createAgentEvent("run-1", "Stop", { success: true }),
        createAgentEvent("run-2", "Stop", { success: true }),
      ])
    ).toThrow(/multiple runIds/);
  });
});
