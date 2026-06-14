import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../src/agent-loop.js";
import type { AppConfig } from "../../src/config.js";
import type { LLMClient } from "../../src/llm-client.js";
import { createDefaultToolRegistry } from "../../src/tools/index.js";
import type {
  ChatCompletionResponse,
  Message,
  ToolCall,
} from "../../src/types.js";

const buggyAdd = `export const add = (a, b) => a - b;
`;

const fixedAdd = `export const add = (a, b) => a + b;
`;

const checkScript = `import { add } from "./add.mjs";
import assert from "node:assert";
assert.strictEqual(add(2, 3), 5);
console.log("Test Files  1 passed (1)");
console.log("      Tests  1 passed (1)");
console.log("   Duration  0.1s");
`;

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 3,
  workingDirectory: "",
  autoApprove: true,
  testCommand: "node check.mjs",
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
      { index: 0, message: { role: "assistant", content: null, tool_calls }, finish_reason: "tool_calls" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function textResponse(content: string): ChatCompletionResponse {
  return {
    id: "resp-text",
    model: "doubao-test",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("W6 verification end-to-end", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-w6-e2e-"));
    await writeFile(path.join(tempDir, "add.mjs"), buggyAdd, "utf8");
    await writeFile(path.join(tempDir, "check.mjs"), checkScript, "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("edits code, auto-runs tests, and records the result in history", async () => {
    const registry = createDefaultToolRegistry(tempDir);
    const responses = [
      toolCallResponse([
        {
          id: "call-edit",
          name: "edit_file",
          args: {
            path: "add.mjs",
            old_string: "(a, b) => a - b",
            new_string: "(a, b) => a + b",
          },
        },
      ]),
      textResponse("已修复 add 函数。"),
    ];
    const sentMessages: Message[][] = [];
    const sendMessage = vi.fn(async (messages: Message[]) => {
      sentMessages.push(messages.map((m) => ({ ...m })));
      const response = responses.shift();
      if (response === undefined) throw new Error("no more mock responses");
      return response;
    });
    const client = { sendMessage } as unknown as LLMClient;

    const result = await runAgentLoop(
      "修复 add.mjs 中的加法 bug",
      { ...baseConfig, workingDirectory: tempDir },
      registry,
      client
    );

    await expect(
      readFile(path.join(tempDir, "add.mjs"), "utf8")
    ).resolves.toBe(fixedAdd);
    expect(result.toolsCalled).toEqual(["edit_file"]);

    const secondTurn = sentMessages[1];
    const verification = secondTurn.find(
      (m) => m.role === "assistant" && (m.content ?? "").includes("[verification]")
    );
    expect(verification).toBeDefined();
    expect(verification?.content).toContain("All tests passed");
  });
});
