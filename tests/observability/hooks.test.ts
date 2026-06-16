import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentEvent } from "../../src/observability/events.js";
import {
  HookRuntime,
  parseHookConfig,
  summarizeHookConfig,
} from "../../src/observability/hooks.js";

describe("HookRuntime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-hooks-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses hook configuration", () => {
    const config = parseHookConfig({
      hooks: {
        SessionStart: [
          {
            matcher: "cli",
            hooks: [
              {
                type: "http",
                url: "https://example.com/events",
                timeout: 1,
                statusMessage: "sending",
              },
            ],
          },
        ],
      },
    });

    expect(config).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "cli",
            hooks: [
              {
                type: "http",
                url: "https://example.com/events",
                timeout: 1,
                statusMessage: "sending",
              },
            ],
          },
        ],
      },
    });
    expect(summarizeHookConfig(config)).toEqual({
      hookEventCount: 1,
      hookCommandCount: 1,
    });
  });

  it("rejects the old flat hook format", () => {
    expect(() =>
      parseHookConfig({
        hooks: {
          SessionStart: [
            { type: "http", url: "https://example.com/events", timeoutMs: 1000 },
          ],
        },
      })
    ).toThrow(/hooks.SessionStart\[0\].hooks/);
  });

  it("posts HTTP hooks in configuration order", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const onHookEvent = vi.fn();
    const runtime = new HookRuntime(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "cli",
              hooks: [
                { type: "http", url: "https://first.example", timeout: 1 },
                { type: "http", url: "https://second.example", timeout: 1 },
              ],
            },
          ],
        },
      },
      {
        fetchImpl,
        onHookEvent,
        sessionId: "session-1",
        transcriptPath: "/tmp/trace.jsonl",
        cwd: "/tmp/project",
      }
    );
    const event = createAgentEvent(
      "run-1",
      "SessionStart",
      { source: "cli" },
      { id: "e1" }
    );

    await runtime.dispatch(event);

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "https://first.example",
      "https://second.example",
    ]);
    expect(await fetchImpl.mock.calls[0]?.[1]?.body).toContain(
      '"hook_event_name":"SessionStart"'
    );
    expect(await fetchImpl.mock.calls[0]?.[1]?.body).toContain(
      '"session_id":"session-1"'
    );
    expect(onHookEvent).toHaveBeenCalledWith(
      "HookStart",
      expect.objectContaining({
        hookEventName: "SessionStart",
        hookType: "http",
        matcher: "cli",
        target: "https://first.example",
      })
    );
    expect(onHookEvent).toHaveBeenCalledWith(
      "HookEnd",
      expect.objectContaining({
        hookEventName: "SessionStart",
        outcome: "success",
        httpStatus: 200,
      })
    );
  });

  it("skips hooks when matcher does not match", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const runtime = new HookRuntime(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "write_file",
              hooks: [{ type: "http", url: "https://example.com", timeout: 1 }],
            },
          ],
        },
      },
      { fetchImpl }
    );

    await runtime.dispatch(
      createAgentEvent("run-1", "PreToolUse", { toolName: "read_file" })
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends command hook events through stdin", async () => {
    const outFile = path.join(tempDir, "event.json");
    const onHookEvent = vi.fn();
    const runtime = new HookRuntime(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "read_file",
              hooks: [
                {
                  type: "command",
                  command: `node -e "process.stdin.pipe(require('fs').createWriteStream('${outFile}'))"`,
                  timeout: 2,
                },
              ],
            },
          ],
        },
      },
      {
        onHookEvent,
        sessionId: "session-1",
        transcriptPath: "/tmp/trace.jsonl",
        cwd: "/tmp/project",
      }
    );
    const event = createAgentEvent(
      "run-1",
      "PreToolUse",
      { toolName: "read_file", input: "path=a.ts" },
      { id: "e1" }
    );

    await runtime.dispatch(event);

    expect(JSON.parse((await readFile(outFile, "utf8")).trim())).toEqual(
      expect.objectContaining({
        session_id: "session-1",
        transcript_path: "/tmp/trace.jsonl",
        cwd: "/tmp/project",
        hook_event_name: "PreToolUse",
        event_id: "e1",
        tool_name: "read_file",
        tool_input_summary: "path=a.ts",
        agent_event: event,
      })
    );
    expect(onHookEvent).toHaveBeenCalledWith(
      "HookEnd",
      expect.objectContaining({
        hookType: "command",
        outcome: "success",
        exitCode: 0,
      })
    );
  });

  it("records JSON stdout from command hooks without applying it", async () => {
    const onHookEvent = vi.fn();
    const runtime = new HookRuntime(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "read_file",
              hooks: [
                {
                  type: "command",
                  command:
                    "node -e \"console.log(JSON.stringify({decision:'block',reason:'audit only'}))\"",
                  timeout: 2,
                },
              ],
            },
          ],
        },
      },
      { onHookEvent }
    );

    await runtime.dispatch(
      createAgentEvent("run-1", "PreToolUse", { toolName: "read_file" })
    );

    expect(onHookEvent).toHaveBeenCalledWith(
      "HookEnd",
      expect.objectContaining({
        outcome: "success",
        hookJson: { decision: "block", reason: "audit only" },
      })
    );
  });

  it("reports hook failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const onFailure = vi.fn();
    const onHookEvent = vi.fn();
    const runtime = new HookRuntime(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "http", url: "https://bad.example", timeout: 1 }],
            },
          ],
        },
      },
      { fetchImpl, onFailure, onHookEvent }
    );
    const event = createAgentEvent("run-1", "SessionStart", {}, { id: "e1" });

    await expect(runtime.dispatch(event)).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(
      event,
      { type: "http", url: "https://bad.example", timeout: 1 },
      expect.any(Error)
    );
    expect(onHookEvent).toHaveBeenCalledWith(
      "HookEnd",
      expect.objectContaining({
        outcome: "error",
        error: expect.stringContaining("HTTP 500"),
      })
    );
  });

  it("does not dispatch hooks for hook failure events", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const runtime = new HookRuntime(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: "http", url: "https://loop.example", timeout: 1 },
              ],
            },
          ],
        },
      },
      { fetchImpl }
    );

    await runtime.dispatch(createAgentEvent("run-1", "HookFailure"));

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
