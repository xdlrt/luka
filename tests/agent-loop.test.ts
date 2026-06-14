import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import { MessageHistory } from "../src/context/message-history.js";
import type { HistoryCompressor } from "../src/context/compressor.js";
import type { HarnessLike } from "../src/harness.js";
import type { EventRecorderLike } from "../src/observability/recorder.js";
import { TodoManager, type TodoItem } from "../src/planning/todo.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import {
  baseConfig,
  createClient,
  textResponse,
  toolCallResponse,
} from "./test-helpers.js";

function createTool(
  name: string,
  output: string
): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    category: "read",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output })),
  };
}

function createHarness(
  executeTool: HarnessLike["executeTool"] = vi.fn(async () => ({
    content: "echo-output",
  }))
): HarnessLike {
  return {
    beginTurn: vi.fn(),
    executeTool,
    endTurn: vi.fn(),
  };
}

function createCompressor(
  options: {
    shouldCompress?: boolean;
    compressedMessages?: MessageHistory;
    throwOnCompress?: boolean;
  } = {}
): HistoryCompressor {
  return {
    shouldCompress: vi.fn(async () => options.shouldCompress ?? false),
    compress: vi.fn(async () => {
      if (options.throwOnCompress) {
        throw new Error("compression failed");
      }
      return (
        options.compressedMessages ??
        new MessageHistory([{ role: "assistant", content: "Context summary:\nok" }])
      );
    }),
  };
}

function createRecorder(): EventRecorderLike {
  return {
    runId: "run-test",
    emit: vi.fn((type, payload = {}) => ({
      schemaVersion: 1,
      id: `${type}-id`,
      runId: "run-test",
      timestamp: "2026-06-14T01:02:03.000Z",
      type,
      payload,
    })),
  };
}

describe("runAgentLoop", () => {
  it("returns directly when the model makes no tool calls", async () => {
    const { client } = createClient([textResponse("hello answer")]);
    const tools = new ToolRegistry();
    const harness = createHarness();

    const result = await runAgentLoop("hi", baseConfig, tools, client, harness);

    expect(result).toEqual({
      finalMessage: "hello answer",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
      todoDisplay: undefined,
    });
    expect(harness.executeTool).not.toHaveBeenCalled();
  });

  it("delegates a tool call to the harness, feeds the result back, then finishes", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: { x: 1 } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "unused"));
    const harness = createHarness(
      vi.fn(async () => ({ content: "echo-output" }))
    );

    const result = await runAgentLoop(
      "run echo",
      baseConfig,
      tools,
      client,
      harness
    );

    expect(result.success).toBe(true);
    expect(result.turnsUsed).toBe(2);
    expect(result.toolsCalled).toEqual(["echo"]);
    expect(result.finalMessage).toBe("done");
    expect(result.totalTokens).toBe(4);
    expect(harness.executeTool).toHaveBeenCalledWith(
      "echo",
      { x: 1 },
      tools,
      "tools: echo"
    );
  });

  it("feeds tool results back using the real tool call id", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([{ id: "call-xyz", name: "echo", args: {} }]),
      textResponse("ok"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));
    const harness = createHarness(
      vi.fn(async () => ({ content: "echo-output" }))
    );

    await runAgentLoop("go", baseConfig, tools, client, harness);

    const secondCallMessages = sentMessages[1];
    const assistantMessage = secondCallMessages.find(
      (m) => m.role === "assistant"
    );
    const toolMessage = secondCallMessages.find((m) => m.role === "tool");
    expect(assistantMessage?.tool_calls?.[0]?.id).toBe("call-xyz");
    expect(toolMessage?.tool_call_id).toBe("call-xyz");
    expect(toolMessage?.content).toBe("echo-output");
  });

  it("injects current todo state into the next model request", async () => {
    const todoManager = new TodoManager();
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-todo",
          name: "todo_write",
          args: {
            todos: [
              { id: "inspect", content: "Inspect code", status: "completed" },
              {
                id: "implement",
                content: "Implement tool",
                status: "in_progress",
              },
            ],
          },
        },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry(todoManager);
    tools.register(createTool("todo_write", "unused"));
    const harness = createHarness(
      vi.fn(async (_toolName, input) => {
        todoManager.update(input.todos as TodoItem[]);
        return { content: todoManager.formatForDisplay() };
      })
    );

    const result = await runAgentLoop(
      "plan task",
      baseConfig,
      tools,
      client,
      harness
    );

    expect(result.todoDisplay).toBe(
      [
        "Progress: 1/2 completed",
        "[x] Inspect code",
        "[~] Implement tool",
      ].join("\n")
    );
    expect(sentMessages[0]?.map((message) => message.content).join("\n")).not.toContain(
      "Current TODO state"
    );
    expect(sentMessages[1]).toEqual(
      expect.arrayContaining([
        {
          role: "system",
          content: [
            "Current TODO state:",
            "Progress: 1/2 completed",
            "[x] Inspect code",
            "[~] Implement tool",
          ].join("\n"),
        },
      ])
    );
  });

  it("handles multiple sequential tool calls across turns", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "c1", name: "read", args: {} }]),
      toolCallResponse([{ id: "c2", name: "write", args: {} }]),
      textResponse("all done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("read", "content"));
    tools.register(createTool("write", "written"));
    const harness = createHarness(
      vi
        .fn()
        .mockResolvedValueOnce({ content: "content" })
        .mockResolvedValueOnce({ content: "written" })
    );

    const result = await runAgentLoop(
      "task",
      baseConfig,
      tools,
      client,
      harness
    );

    expect(result.toolsCalled).toEqual(["read", "write"]);
    expect(result.turnsUsed).toBe(3);
    expect(result.success).toBe(true);
    expect(result.totalTokens).toBe(6);
  });

  it("stops and reports failure when maxTurns is reached", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "c1", name: "echo", args: {} }]),
      toolCallResponse([{ id: "c2", name: "echo", args: {} }]),
      toolCallResponse([{ id: "c3", name: "echo", args: {} }]),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "out"));
    const harness = createHarness();

    const result = await runAgentLoop(
      "loop",
      { ...baseConfig, maxTurns: 2 },
      tools,
      client,
      harness
    );

    expect(result.success).toBe(false);
    expect(result.turnsUsed).toBe(2);
    expect(result.toolsCalled).toEqual(["echo", "echo"]);
    expect(result.totalTokens).toBe(4);
  });

  it("logs approximate context size in verbose mode", async () => {
    const { client } = createClient([textResponse("done")]);
    const tools = new ToolRegistry();
    const harness = createHarness();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await runAgentLoop(
      "hi",
      { ...baseConfig, verbose: true },
      tools,
      client,
      harness,
      logger
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[CONTEXT\] messages=2, approxTokens=\d+$/)
    );
  });

  it("compresses history before sending messages to the model", async () => {
    const { client, sentMessages } = createClient([textResponse("done")]);
    const tools = new ToolRegistry();
    const harness = createHarness();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const compressor = createCompressor({
      shouldCompress: true,
      compressedMessages: new MessageHistory([
        { role: "system", content: "system" },
        { role: "assistant", content: "Context summary:\nold work" },
        { role: "user", content: "latest task" },
      ]),
    });

    await runAgentLoop(
      "hi",
      baseConfig,
      tools,
      client,
      harness,
      logger,
      compressor
    );

    expect(compressor.shouldCompress).toHaveBeenCalledTimes(1);
    expect(compressor.compress).toHaveBeenCalledTimes(1);
    expect(sentMessages[0]).toEqual([
      { role: "system", content: "system" },
      { role: "assistant", content: "Context summary:\nold work" },
      { role: "user", content: "latest task" },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[CONTEXT\] Compressing: \d+ → \d+ tokens$/)
    );
  });

  it("does not compress short conversations", async () => {
    const { client } = createClient([textResponse("done")]);
    const tools = new ToolRegistry();
    const harness = createHarness();
    const compressor = createCompressor({ shouldCompress: false });

    await runAgentLoop(
      "hi",
      baseConfig,
      tools,
      client,
      harness,
      undefined,
      compressor
    );

    expect(compressor.shouldCompress).toHaveBeenCalledTimes(1);
    expect(compressor.compress).not.toHaveBeenCalled();
  });

  it("continues tool execution after compression", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: {} }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));
    const harness = createHarness(
      vi.fn(async () => ({ content: "echo-output" }))
    );
    const compressor = createCompressor({
      shouldCompress: true,
      compressedMessages: new MessageHistory([
        { role: "system", content: "system" },
        { role: "assistant", content: "Context summary:\nold work" },
        { role: "user", content: "latest task" },
      ]),
    });

    const result = await runAgentLoop(
      "run echo",
      baseConfig,
      tools,
      client,
      harness,
      undefined,
      compressor
    );

    expect(result.success).toBe(true);
    expect(result.toolsCalled).toEqual(["echo"]);
    expect(harness.executeTool).toHaveBeenCalledWith(
      "echo",
      {},
      tools,
      "tools: echo"
    );
  });

  it("surfaces compression failures", async () => {
    const { client } = createClient([textResponse("done")]);
    const tools = new ToolRegistry();
    const harness = createHarness();
    const compressor = createCompressor({
      shouldCompress: true,
      throwOnCompress: true,
    });

    await expect(
      runAgentLoop(
        "hi",
        baseConfig,
        tools,
        client,
        harness,
        undefined,
        compressor
      )
    ).rejects.toThrow("compression failed");
  });

  it("injects verification messages returned by the harness", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        { id: "call-1", name: "edit_file", args: { path: "a.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file", "ok"));
    const harness = createHarness(
      vi.fn(async () => ({
        content: "ok",
        verificationMessage: "[verification] All tests passed",
      }))
    );

    await runAgentLoop("fix", baseConfig, tools, client, harness);

    expect(
      sentMessages[1].some(
        (message) =>
          message.role === "assistant" &&
          message.content === "[verification] All tests passed"
      )
    ).toBe(true);
  });

  it("marks turn boundaries on the harness", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: {} }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));
    const harness = createHarness();

    await runAgentLoop("run echo", baseConfig, tools, client, harness);

    expect(harness.beginTurn).toHaveBeenCalledTimes(2);
    expect(harness.endTurn).toHaveBeenCalledTimes(1);
  });

  it("does not call ToolRegistry.execute directly", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: {} }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));
    const executeSpy = vi.spyOn(tools, "execute");
    const harness = createHarness();

    await runAgentLoop("run echo", baseConfig, tools, client, harness);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(harness.executeTool).toHaveBeenCalledWith(
      "echo",
      {},
      tools,
      "tools: echo"
    );
  });

  it("records LLM lifecycle and successful stop events", async () => {
    const { client } = createClient([textResponse("done")]);
    const tools = new ToolRegistry();
    const harness = createHarness();
    const recorder = createRecorder();

    await runAgentLoop(
      "hi",
      baseConfig,
      tools,
      client,
      harness,
      undefined,
      undefined,
      recorder
    );

    expect(recorder.emit).toHaveBeenCalledWith(
      "LLMRequest",
      expect.objectContaining({ turn: 1, model: "doubao-test" })
    );
    expect(recorder.emit).toHaveBeenCalledWith(
      "LLMResponse",
      expect.objectContaining({ turn: 1, toolCallCount: 0 })
    );
    expect(recorder.emit).toHaveBeenCalledWith(
      "Stop",
      expect.objectContaining({ success: true, finalState: "no_tool_calls" })
    );
  });

  it("records max-turn stop events", async () => {
    const { client } = createClient([
      toolCallResponse([{ id: "c1", name: "echo", args: {} }]),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "out"));
    const harness = createHarness();
    const recorder = createRecorder();

    await runAgentLoop(
      "loop",
      { ...baseConfig, maxTurns: 1 },
      tools,
      client,
      harness,
      undefined,
      undefined,
      recorder
    );

    expect(recorder.emit).toHaveBeenCalledWith(
      "Stop",
      expect.objectContaining({ success: false, finalState: "max_turns" })
    );
  });
});
