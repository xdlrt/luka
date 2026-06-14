import { vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { LLMClient } from "../src/llm-client.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../src/types.js";

export const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
  autoApprove: false,
  maxRetries: 3,
  verbose: false,
  observability: {
    localDir: ".coding-agent/observability",
    feedback: {
      enabled: false,
      timeoutMs: 3000,
      batchSize: 20,
    },
  },
};

export function textResponse(content: string): ChatCompletionResponse {
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

export function toolCallResponse(
  calls: { id: string; name: string; args: Record<string, unknown> }[]
): ChatCompletionResponse {
  const tool_calls: ToolCall[] = calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
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

export function createClient(responses: ChatCompletionResponse[]): {
  client: LLMClient;
  sentMessages: Message[][];
} {
  const sentMessages: Message[][] = [];
  const queue = [...responses];
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
