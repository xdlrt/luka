import { describe, expect, it } from "vitest";
import {
  createAgentEvent,
  redactEventPayload,
  summarizeForEvent,
  validateAgentEvent,
} from "../../src/observability/events.js";

describe("observability events", () => {
  it("creates a valid versioned event", () => {
    const event = createAgentEvent(
      "run-1",
      "SessionStart",
      { cwd: "/tmp/project" },
      { id: "event-1", timestamp: "2026-06-14T01:02:03.000Z" }
    );

    expect(event).toEqual({
      schemaVersion: 1,
      id: "event-1",
      runId: "run-1",
      timestamp: "2026-06-14T01:02:03.000Z",
      type: "SessionStart",
      payload: { cwd: "/tmp/project" },
    });
    expect(validateAgentEvent(event)).toEqual(event);
  });

  it("rejects invalid schema versions", () => {
    expect(() =>
      validateAgentEvent({
        schemaVersion: 2,
        id: "event-1",
        runId: "run-1",
        timestamp: "2026-06-14T01:02:03.000Z",
        type: "SessionStart",
        payload: {},
      })
    ).toThrow(/schemaVersion/);
  });

  it("rejects unknown event types", () => {
    expect(() =>
      validateAgentEvent({
        schemaVersion: 1,
        id: "event-1",
        runId: "run-1",
        timestamp: "2026-06-14T01:02:03.000Z",
        type: "Unknown",
        payload: {},
      })
    ).toThrow(/Unknown event type/);
  });

  it("creates hook execution events", () => {
    expect(
      validateAgentEvent(
        createAgentEvent("run-1", "HookStart", {
          hookId: "hook-1",
          hookEventName: "PreToolUse",
          hookType: "command",
        })
      )
    ).toMatchObject({
      type: "HookStart",
      payload: {
        hookId: "hook-1",
        hookEventName: "PreToolUse",
        hookType: "command",
      },
    });
    expect(
      validateAgentEvent(
        createAgentEvent("run-1", "HookEnd", {
          hookId: "hook-1",
          outcome: "success",
          stdout: "ok",
        })
      )
    ).toMatchObject({
      type: "HookEnd",
      payload: {
        hookId: "hook-1",
        outcome: "success",
        stdout: "ok",
      },
    });
  });

  it("rejects invalid payload shape", () => {
    expect(() =>
      validateAgentEvent({
        schemaVersion: 1,
        id: "event-1",
        runId: "run-1",
        timestamp: "2026-06-14T01:02:03.000Z",
        type: "SessionStart",
        payload: "not-object",
      })
    ).toThrow(/payload/);
  });

  it("redacts sensitive keys and credential-looking strings", () => {
    expect(
      redactEventPayload({
        ARK_API_KEY: "real-key",
        nested: {
          Authorization: "Bearer abc123",
          command: "TOKEN=abc npm test",
        },
      })
    ).toEqual({
      ARK_API_KEY: "[redacted]",
      nested: {
        Authorization: "[redacted]",
        command: "TOKEN=[redacted] npm test",
      },
    });
  });

  it("truncates event summaries", () => {
    const summary = summarizeForEvent("x".repeat(600));

    expect(summary).toHaveLength(514);
    expect(summary.endsWith("...[truncated]")).toBe(true);
  });
});
