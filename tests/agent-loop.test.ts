import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import type { HarnessLike } from "../src/harness.js";
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
    const toolMessage = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call-xyz");
    expect(toolMessage?.content).toBe("echo-output");
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
});
