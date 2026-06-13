import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import type { LLMClient } from "../src/llm-client.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../src/types.js";

const baseConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
  autoApprove: false,
};

function textResponse(content: string): ChatCompletionResponse {
  return {
    id: "resp",
    model: "doubao-test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function toolCallResponse(
  calls: { id: string; name: string; args: Record<string, unknown> }[]
): ChatCompletionResponse {
  const tool_calls: ToolCall[] = calls.map((c) => ({
    id: c.id,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
  return {
    id: "resp",
    model: "doubao-test",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: null, tool_calls },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function makeClient(responses: ChatCompletionResponse[]): LLMClient {
  let index = 0;
  const sendMessage = vi.fn(async () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) throw new Error("no more mock responses");
    return response;
  });
  return { sendMessage } as unknown as LLMClient;
}

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

describe("runAgentLoop", () => {
  it("returns directly when the model makes no tool calls", async () => {
    const client = makeClient([textResponse("hello answer")]);
    const tools = new ToolRegistry();

    const result = await runAgentLoop("hi", baseConfig, tools, client);

    expect(result).toEqual({
      finalMessage: "hello answer",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
    });
  });

  it("executes a tool call, feeds the result back, then finishes", async () => {
    const client = makeClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: { x: 1 } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    const echo = createTool("echo", "echo-output");
    tools.register(echo);

    const result = await runAgentLoop("run echo", baseConfig, tools, client);

    expect(result.success).toBe(true);
    expect(result.turnsUsed).toBe(2);
    expect(result.toolsCalled).toEqual(["echo"]);
    expect(result.finalMessage).toBe("done");
    expect(echo.execute).toHaveBeenCalledWith({ x: 1 });
  });

  it("feeds tool results back using the real tool call id", async () => {
    const responses = [
      toolCallResponse([{ id: "call-xyz", name: "echo", args: {} }]),
      textResponse("ok"),
    ];
    const sentMessages: Message[][] = [];
    const sendMessage = vi.fn(async (messages: Message[]) => {
      sentMessages.push(messages.map((m) => ({ ...m })));
      return responses.shift() as ChatCompletionResponse;
    });
    const client = { sendMessage } as unknown as LLMClient;
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));

    await runAgentLoop("go", baseConfig, tools, client);

    const secondCallMessages = sentMessages[1];
    const toolMessage = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("call-xyz");
    expect(toolMessage?.content).toBe("echo-output");
  });

  it("handles multiple sequential tool calls across turns", async () => {
    const client = makeClient([
      toolCallResponse([{ id: "c1", name: "read", args: {} }]),
      toolCallResponse([{ id: "c2", name: "write", args: {} }]),
      textResponse("all done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("read", "content"));
    tools.register(createTool("write", "written"));

    const result = await runAgentLoop("task", baseConfig, tools, client);

    expect(result.toolsCalled).toEqual(["read", "write"]);
    expect(result.turnsUsed).toBe(3);
    expect(result.success).toBe(true);
  });

  it("stops and reports failure when maxTurns is reached", async () => {
    const client = makeClient([
      toolCallResponse([{ id: "c1", name: "echo", args: {} }]),
      toolCallResponse([{ id: "c2", name: "echo", args: {} }]),
      toolCallResponse([{ id: "c3", name: "echo", args: {} }]),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "out"));

    const result = await runAgentLoop(
      "loop",
      { ...baseConfig, maxTurns: 2 },
      tools,
      client
    );

    expect(result.success).toBe(false);
    expect(result.turnsUsed).toBe(2);
    expect(result.toolsCalled).toEqual(["echo", "echo"]);
  });

  it("passes autoApprove to the permission checker", async () => {
    const client = makeClient([
      toolCallResponse([{ id: "call-1", name: "echo", args: { x: 1 } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("echo", "echo-output"));
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));

    await runAgentLoop(
      "run echo",
      { ...baseConfig, autoApprove: true },
      tools,
      client,
      permissionCheck
    );

    expect(permissionCheck).toHaveBeenCalledWith(
      expect.objectContaining({ name: "echo" }),
      { x: 1 },
      { autoApprove: true }
    );
  });
});
