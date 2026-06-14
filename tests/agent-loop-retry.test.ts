import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type SafetyChecker } from "../src/agent-loop.js";
import type { AppConfig } from "../src/config.js";
import type { LLMClient } from "../src/llm-client.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../src/types.js";
import type { TestResult } from "../src/verification/test-runner.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
  autoApprove: true,
  testCommand: "npm test",
  maxRetries: 3,
  verbose: false,
};

const allowSafety: SafetyChecker = vi.fn(async () => ({ allowed: true }));
const approve = vi.fn(async () => ({ approved: true as const }));
const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function textResponse(content: string): ChatCompletionResponse {
  return {
    id: "resp-text",
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
  const tool_calls: ToolCall[] = calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));

  return {
    id: "resp-tool",
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

function makeClient(responses: ChatCompletionResponse[]): {
  client: LLMClient;
  sentMessages: Message[][];
} {
  const queue = [...responses];
  const sentMessages: Message[][] = [];
  const sendMessage = vi.fn(async (messages: Message[]) => {
    sentMessages.push(messages.map((message) => ({ ...message })));
    const response = queue.shift();
    if (response === undefined) throw new Error("no more mock responses");
    return response;
  });

  return {
    client: { sendMessage } as unknown as LLMClient,
    sentMessages,
  };
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    category: "write",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output: "ok" })),
  };
}

function testResult(passed: boolean): TestResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed
      ? "Test Files  1 passed (1)\n      Tests  1 passed (1)\n   Duration  0.1s"
      : "FAIL src/add.test.ts > add > should add\n    Expected: 5\n    Received: 4\n      Tests  1 failed | 0 passed (1)",
    stderr: "",
    durationMs: 100,
  };
}

describe("runAgentLoop retry integration", () => {
  it("feeds failed tests back to the model and lets it edit again", async () => {
    const { client, sentMessages } = makeClient([
      toolCallResponse([
        { id: "edit-1", name: "edit_file", args: { path: "add.ts" } },
      ]),
      toolCallResponse([
        { id: "edit-2", name: "edit_file", args: { path: "add.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi
      .fn()
      .mockResolvedValueOnce(testResult(false))
      .mockResolvedValueOnce(testResult(true));

    const result = await runAgentLoop(
      "fix add",
      baseConfig,
      tools,
      client,
      approve,
      allowSafety,
      testRunner,
      silentLogger
    );

    expect(result.success).toBe(true);
    expect(testRunner).toHaveBeenCalledTimes(2);
    expect(result.toolsCalled).toEqual(["edit_file", "edit_file"]);
    expect(
      sentMessages[1].some((message) =>
        (message.content ?? "").includes("Tests failed. Please fix the issues")
      )
    ).toBe(true);
    expect(
      sentMessages[2].some((message) =>
        (message.content ?? "").includes("[verification] All tests passed")
      )
    ).toBe(true);
  });

  it("stops retrying after maxRetries and continues the conversation", async () => {
    const { client, sentMessages } = makeClient([
      toolCallResponse([
        { id: "edit-1", name: "edit_file", args: { path: "add.ts" } },
      ]),
      toolCallResponse([
        { id: "edit-2", name: "edit_file", args: { path: "add.ts" } },
      ]),
      textResponse("I could not fix it."),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => testResult(false));

    const result = await runAgentLoop(
      "fix add",
      { ...baseConfig, maxRetries: 2 },
      tools,
      client,
      approve,
      allowSafety,
      testRunner,
      silentLogger
    );

    expect(result.success).toBe(true);
    expect(testRunner).toHaveBeenCalledTimes(2);
    expect(
      sentMessages[2].some((message) =>
        (message.content ?? "").includes("Unable to fix after 2 attempts")
      )
    ).toBe(true);
  });

  it("does not retry when verification is disabled", async () => {
    const { client } = makeClient([
      toolCallResponse([
        { id: "edit-1", name: "edit_file", args: { path: "add.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => testResult(false));

    await runAgentLoop(
      "fix add",
      { ...baseConfig, testCommand: undefined },
      tools,
      client,
      approve,
      allowSafety,
      testRunner,
      silentLogger
    );

    expect(testRunner).not.toHaveBeenCalled();
  });

  it("does not run verification when an edit tool returns an error", async () => {
    const { client } = makeClient([
      toolCallResponse([
        { id: "edit-1", name: "edit_file", args: { path: "add.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register({
      ...createTool("edit_file"),
      execute: vi.fn(async () => ({
        tool_call_id: "edit_file",
        output: "not edited",
        error: "old string not found",
      })),
    });
    const testRunner = vi.fn(async () => testResult(false));

    await runAgentLoop(
      "fix add",
      baseConfig,
      tools,
      client,
      approve,
      allowSafety,
      testRunner,
      silentLogger
    );

    expect(testRunner).not.toHaveBeenCalled();
  });
});
