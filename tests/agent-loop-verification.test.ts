import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, type SafetyChecker } from "../src/agent-loop.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import type { AppConfig } from "../src/config.js";
import type { LLMClient } from "../src/llm-client.js";
import type { TestResult } from "../src/verification/test-runner.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../src/types.js";

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

function textResponse(content: string): ChatCompletionResponse {
  return {
    id: "resp",
    model: "doubao-test",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
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
      { index: 0, message: { role: "assistant", content: null, tool_calls }, finish_reason: "tool_calls" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function makeClientCapturing(responses: ChatCompletionResponse[]): {
  client: LLMClient;
  sent: Message[][];
} {
  const sent: Message[][] = [];
  const queue = [...responses];
  const sendMessage = vi.fn(async (messages: Message[]) => {
    sent.push(messages.map((m) => ({ ...m })));
    const response = queue.shift();
    if (response === undefined) throw new Error("no more mock responses");
    return response;
  });
  return { client: { sendMessage } as unknown as LLMClient, sent };
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    category: name === "read_file" ? "read" : "write",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output: "ok" })),
  };
}

function passingResult(): TestResult {
  return {
    passed: true,
    exitCode: 0,
    stdout: "Test Files  1 passed (1)\n      Tests  2 passed (2)\n   Duration  0.5s",
    stderr: "",
    durationMs: 500,
  };
}

describe("runAgentLoop post-edit verification", () => {
  it("runs tests after an edit and injects an assistant message", async () => {
    const { client, sent } = makeClientCapturing([
      toolCallResponse([{ id: "c1", name: "edit_file", args: { path: "a.ts" } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => passingResult());

    await runAgentLoop(
      "fix",
      baseConfig,
      tools,
      client,
      approve,
      allowSafety,
      testRunner
    );

    expect(testRunner).toHaveBeenCalledWith("npm test", "/tmp");
    const secondTurn = sent[1];
    const verification = secondTurn.find(
      (m) => m.role === "assistant" && (m.content ?? "").includes("[verification]")
    );
    expect(verification?.content).toContain("All tests passed (2 tests in 1 file, 0.5s)");
  });

  it("skips verification when no testCommand is configured", async () => {
    const { client } = makeClientCapturing([
      toolCallResponse([{ id: "c1", name: "edit_file", args: { path: "a.ts" } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => passingResult());

    await runAgentLoop(
      "fix",
      { ...baseConfig, testCommand: undefined },
      tools,
      client,
      approve,
      allowSafety,
      testRunner
    );

    expect(testRunner).not.toHaveBeenCalled();
  });

  it("does not run tests when only a non-edit tool was used", async () => {
    const { client } = makeClientCapturing([
      toolCallResponse([{ id: "c1", name: "read_file", args: { path: "a.ts" } }]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("read_file"));
    const testRunner = vi.fn(async () => passingResult());

    await runAgentLoop(
      "read",
      baseConfig,
      tools,
      client,
      approve,
      allowSafety,
      testRunner
    );

    expect(testRunner).not.toHaveBeenCalled();
  });
});
