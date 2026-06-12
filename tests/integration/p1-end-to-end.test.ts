import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../src/agent-loop.js";
import type { LLMClient } from "../../src/llm-client.js";
import { createDefaultToolRegistry } from "../../src/tools/index.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../../src/types.js";

const greetSource = `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;

const baseConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 3,
  workingDirectory: "",
};

function toolCallResponse(
  calls: { id: string; name: string; args: Record<string, unknown> }[]
): ChatCompletionResponse {
  const tool_calls: ToolCall[] = calls.map((call) => ({
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args),
    },
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

describe("P1 end-to-end agent demo", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-p1-e2e-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes a code file, reads it back, and finishes within three turns", async () => {
    const registry = createDefaultToolRegistry(tempDir);
    const responses = [
      toolCallResponse([
        {
          id: "call-write",
          name: "write_file",
          args: { path: "src/greet.ts", content: greetSource },
        },
      ]),
      toolCallResponse([
        {
          id: "call-read",
          name: "read_file",
          args: { path: "src/greet.ts" },
        },
      ]),
      textResponse("已创建并验证 src/greet.ts。"),
    ];
    const sentMessages: Message[][] = [];
    const sendMessage = vi.fn(async (messages: Message[]) => {
      sentMessages.push(messages.map((message) => ({ ...message })));
      const response = responses.shift();
      if (response === undefined) throw new Error("no more mock responses");
      return response;
    });
    const client = { sendMessage } as unknown as LLMClient;

    const result = await runAgentLoop(
      "在 src/greet.ts 中创建一个函数 greet(name) 返回 Hello, name!",
      { ...baseConfig, workingDirectory: tempDir },
      registry,
      client
    );

    await expect(
      readFile(path.join(tempDir, "src/greet.ts"), "utf8")
    ).resolves.toBe(greetSource);
    expect(result).toEqual({
      finalMessage: "已创建并验证 src/greet.ts。",
      turnsUsed: 3,
      toolsCalled: ["write_file", "read_file"],
      success: true,
    });
    expect(sendMessage).toHaveBeenCalledTimes(3);

    const thirdTurnMessages = sentMessages[2];
    const readResultMessage = thirdTurnMessages.find(
      (message) =>
        message.role === "tool" && message.tool_call_id === "call-read"
    );
    expect(readResultMessage?.content).toContain(
      "export function greet(name: string): string"
    );
    expect(readResultMessage?.content).toContain("Hello, ${name}!");
  });
});
