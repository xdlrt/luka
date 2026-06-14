import { readFile } from "node:fs/promises";
import type { AgentEvent, AgentEventType } from "../observability/events.js";
import { validateAgentEvent } from "../observability/events.js";
import type { EvalFeedbackStatus } from "./types.js";

export interface TraceSummary {
  runId: string;
  turnsUsed: number;
  toolCalls: string[];
  permissionDeniedCount: number;
  verificationRuns: number;
  feedbackStatus: EvalFeedbackStatus;
  stopSuccess?: boolean;
  stopState?: string;
  evalPassed?: boolean;
  evalFailureReason?: string;
}

export async function readTraceSummary(tracePath: string): Promise<TraceSummary> {
  const raw = await readFile(tracePath, "utf8");
  const events = parseTraceEvents(raw);
  return summarizeTraceEvents(events);
}

export function parseTraceEvents(raw: string): AgentEvent[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("trace is empty");
  }

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Invalid trace JSON on line ${index + 1}: ${reason}`);
    }
    return validateAgentEvent(parsed);
  });
}

export function summarizeTraceEvents(events: AgentEvent[]): TraceSummary {
  if (events.length === 0) {
    throw new Error("trace is empty");
  }

  const runId = events[0]?.runId;
  if (runId === undefined) {
    throw new Error("trace is missing runId");
  }

  let turnsUsed = 0;
  const toolCalls: string[] = [];
  let permissionDeniedCount = 0;
  let verificationRuns = 0;
  let stopSuccess: boolean | undefined;
  let stopState: string | undefined;
  let evalPassed: boolean | undefined;
  let evalFailureReason: string | undefined;
  let hasFeedbackSignal = false;
  let hasFeedbackFailure = false;

  for (const event of events) {
    if (event.runId !== runId) {
      throw new Error("trace contains multiple runIds");
    }
    switch (event.type) {
      case "LLMResponse":
        turnsUsed = Math.max(turnsUsed, numberPayload(event, "turn") ?? 0);
        break;
      case "PreToolUse": {
        const toolName = stringPayload(event, "toolName");
        if (toolName !== undefined) toolCalls.push(toolName);
        break;
      }
      case "PermissionRequest":
        if (booleanPayload(event, "approved") === false) {
          permissionDeniedCount += 1;
        }
        break;
      case "VerificationEnd":
        verificationRuns += 1;
        break;
      case "Stop":
        stopSuccess = booleanPayload(event, "success");
        stopState = stringPayload(event, "finalState");
        break;
      case "EvalTaskEnd":
        evalPassed = booleanPayload(event, "passed");
        evalFailureReason = stringPayload(event, "failureReason");
        break;
      case "HookFailure":
        hasFeedbackFailure = true;
        break;
      default:
        updateFeedbackSignal(event.type, event.payload, {
          markConfigured: () => {
            hasFeedbackSignal = true;
          },
          markFailed: () => {
            hasFeedbackFailure = true;
          },
        });
    }
  }

  if (stopSuccess === undefined) {
    throw new Error("trace is missing Stop event");
  }

  return {
    runId,
    turnsUsed,
    toolCalls,
    permissionDeniedCount,
    verificationRuns,
    feedbackStatus: resolveFeedbackStatus(hasFeedbackSignal, hasFeedbackFailure),
    stopSuccess,
    stopState,
    evalPassed,
    evalFailureReason,
  };
}

function resolveFeedbackStatus(
  hasFeedbackSignal: boolean,
  hasFeedbackFailure: boolean
): EvalFeedbackStatus {
  if (hasFeedbackFailure) return "failed";
  return hasFeedbackSignal ? "ok" : "not_configured";
}

function updateFeedbackSignal(
  _type: AgentEventType,
  payload: Record<string, unknown>,
  marker: { markConfigured(): void; markFailed(): void }
): void {
  const feedback = payload.feedbackStatus ?? payload.feedback ?? payload.status;
  if (feedback === undefined) return;
  marker.markConfigured();
  if (feedback === "failed" || feedback === false) {
    marker.markFailed();
  }
}

function numberPayload(event: AgentEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" ? value : undefined;
}

function stringPayload(event: AgentEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}

function booleanPayload(event: AgentEvent, key: string): boolean | undefined {
  const value = event.payload[key];
  return typeof value === "boolean" ? value : undefined;
}
