import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentEvent } from "../../src/observability/events.js";
import { HttpFeedbackSink, LocalJsonlSink } from "../../src/observability/sinks.js";
import { createObservabilitySinks } from "../../src/session.js";

describe("observability sinks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-sinks-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes one JSON event per line", async () => {
    const sink = new LocalJsonlSink({ directory: tempDir, runId: "run-1" });
    const event = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });

    await sink.write(event);

    const content = await readFile(path.join(tempDir, "run-1.jsonl"), "utf8");
    expect(content.trim()).toBe(JSON.stringify(event));
  });

  it("posts HTTP feedback in batches", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const sink = new HttpFeedbackSink({
      url: "https://feedback.example/events",
      timeoutMs: 1000,
      batchSize: 2,
      fetchImpl,
    });
    const first = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });
    const second = createAgentEvent("run-1", "SessionEnd", {}, { id: "e2" });

    await sink.write(first);
    expect(fetchImpl).not.toHaveBeenCalled();
    await sink.write(second);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://feedback.example/events",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([first, second]),
      })
    );
  });

  it("throws on non-2xx HTTP feedback responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const sink = new HttpFeedbackSink({
      url: "https://feedback.example/events",
      timeoutMs: 1000,
      batchSize: 1,
      fetchImpl,
    });

    await expect(
      sink.write(createAgentEvent("run-1", "SessionStart"))
    ).rejects.toThrow(/HTTP 500/);
  });

  it("creates an OTel sink only when enabled with an endpoint", () => {
    const disabled = createObservabilitySinks(
      {
        apiKey: "key",
        baseURL: "https://example.com",
        model: "model",
        maxTurns: 1,
        workingDirectory: tempDir,
        autoApprove: false,
        maxRetries: 1,
        verbose: false,
        observability: {
          localDir: ".events",
          feedback: { enabled: false, timeoutMs: 3000, batchSize: 20 },
          otel: { enabled: true, serviceName: "coding-agent", timeoutMs: 3000 },
        },
      },
      "run-1"
    );
    const enabled = createObservabilitySinks(
      {
        apiKey: "key",
        baseURL: "https://example.com",
        model: "model",
        maxTurns: 1,
        workingDirectory: tempDir,
        autoApprove: false,
        maxRetries: 1,
        verbose: false,
        observability: {
          localDir: ".events",
          feedback: { enabled: false, timeoutMs: 3000, batchSize: 20 },
          otel: {
            enabled: true,
            endpoint: "https://otel.example/v1/traces",
            serviceName: "coding-agent",
            timeoutMs: 3000,
          },
        },
      },
      "run-2"
    );

    expect(disabled.sinks).toHaveLength(1);
    expect(enabled.sinks).toHaveLength(2);
  });
});
