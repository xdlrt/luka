import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentEvent } from "../../src/observability/events.js";
import { HookRuntime, parseHookConfig } from "../../src/observability/hooks.js";

describe("HookRuntime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-hooks-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses hook configuration", () => {
    expect(
      parseHookConfig({
        hooks: {
          SessionStart: [
            { type: "http", url: "https://example.com/events", timeoutMs: 1000 },
          ],
        },
      })
    ).toEqual({
      hooks: {
        SessionStart: [
          { type: "http", url: "https://example.com/events", timeoutMs: 1000 },
        ],
      },
    });
  });

  it("posts HTTP hooks in configuration order", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const runtime = new HookRuntime(
      {
        hooks: {
          SessionStart: [
            { type: "http", url: "https://first.example", timeoutMs: 1000 },
            { type: "http", url: "https://second.example", timeoutMs: 1000 },
          ],
        },
      },
      { fetchImpl }
    );
    const event = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });

    await runtime.dispatch(event);

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://first.example",
      "https://second.example",
    ]);
  });

  it("sends command hook events through stdin", async () => {
    const outFile = path.join(tempDir, "event.json");
    const runtime = new HookRuntime({
      hooks: {
        SessionStart: [
          {
            type: "command",
            command: `node -e "process.stdin.pipe(require('fs').createWriteStream('${outFile}'))"`,
            timeoutMs: 2000,
          },
        ],
      },
    });
    const event = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });

    await runtime.dispatch(event);

    expect((await readFile(outFile, "utf8")).trim()).toBe(JSON.stringify(event));
  });

  it("reports hook failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const onFailure = vi.fn();
    const runtime = new HookRuntime(
      {
        hooks: {
          SessionStart: [
            { type: "http", url: "https://bad.example", timeoutMs: 1000 },
          ],
        },
      },
      { fetchImpl, onFailure }
    );
    const event = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });

    await expect(runtime.dispatch(event)).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(
      event,
      { type: "http", url: "https://bad.example", timeoutMs: 1000 },
      expect.any(Error)
    );
  });

  it("does not dispatch hooks for hook failure events", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const runtime = new HookRuntime(
      {
        hooks: {
          HookFailure: [
            { type: "http", url: "https://loop.example", timeoutMs: 1000 },
          ],
        },
      },
      { fetchImpl }
    );

    await runtime.dispatch(createAgentEvent("run-1", "HookFailure"));

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
