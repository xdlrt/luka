import { describe, expect, it, vi } from "vitest";
import { EventRecorder } from "../../src/observability/recorder.js";
import type { EventSink } from "../../src/observability/sinks.js";

describe("EventRecorder", () => {
  it("writes valid events to configured sinks", async () => {
    const sink: EventSink = { write: vi.fn(async () => {}) };
    const recorder = new EventRecorder({ runId: "run-1", sinks: [sink] });

    const event = recorder.emit("SessionStart", { cwd: "/tmp" });

    expect(event.runId).toBe("run-1");
    expect(event.type).toBe("SessionStart");
    await recorder.flush();
    expect(sink.write).toHaveBeenCalledWith(event);
  });

  it("does not wait for slow sinks during emit", async () => {
    const slowSink: EventSink = {
      write: vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 50))
      ),
    };
    const recorder = new EventRecorder({ runId: "run-1", sinks: [slowSink] });
    const startedAt = Date.now();

    const event = recorder.emit("SessionStart", {});

    expect(event.type).toBe("SessionStart");
    expect(Date.now() - startedAt).toBeLessThan(20);
    await recorder.flush();
  });

  it("continues when a sink write fails and reports stderr", async () => {
    const stderr = { write: vi.fn() };
    const failingSink: EventSink = {
      write: vi.fn(async () => {
        throw new Error("disk full");
      }),
    };
    const recorder = new EventRecorder({
      runId: "run-1",
      sinks: [failingSink],
      stderr,
    });

    expect(recorder.emit("SessionStart")).toMatchObject({
      type: "SessionStart",
    });
    await recorder.flush();
    expect(stderr.write).toHaveBeenCalledWith(
      "[observability] sink write failed: disk full\n"
    );
  });

  it("flushes and closes sinks without throwing on failures", async () => {
    const stderr = { write: vi.fn() };
    const sink: EventSink = {
      write: vi.fn(async () => {}),
      flush: vi.fn(async () => {
        throw new Error("flush failed");
      }),
      close: vi.fn(async () => {
        throw new Error("close failed");
      }),
    };
    const recorder = new EventRecorder({ runId: "run-1", sinks: [sink], stderr });

    await recorder.flush();
    await recorder.close();

    expect(stderr.write).toHaveBeenCalledWith(
      "[observability] sink flush failed: flush failed\n"
    );
    expect(stderr.write).toHaveBeenCalledWith(
      "[observability] sink close failed: close failed\n"
    );
  });

  it("times out flush without throwing when the drain is slow", async () => {
    const stderr = { write: vi.fn() };
    const slowSink: EventSink = {
      write: vi.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 50))
      ),
    };
    const recorder = new EventRecorder({
      runId: "run-1",
      sinks: [slowSink],
      stderr,
    });

    recorder.emit("SessionStart", {});
    await recorder.flush({ timeoutMs: 1 });

    expect(stderr.write).toHaveBeenCalledWith(
      "[observability] flush timed out after 1ms\n"
    );
    await recorder.flush();
  });

  it("emits hook failures as normal events without throwing", async () => {
    const sink: EventSink = { write: vi.fn(async () => {}) };
    const recorder = new EventRecorder({ runId: "run-1", sinks: [sink] });
    const source = recorder.emit("SessionStart", {});

    recorder.emitHookFailure(
      source,
      { type: "http", url: "https://bad.example", timeoutMs: 1 },
      new Error("network failed")
    );
    await recorder.flush();

    expect(sink.write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "HookFailure",
        payload: expect.objectContaining({
          sourceEventId: source.id,
          hookType: "http",
          error: "network failed",
        }),
      })
    );
  });
});
