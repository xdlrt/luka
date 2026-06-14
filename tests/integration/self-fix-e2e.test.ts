import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const buggyUtils = `export function reverseString(value) {
  return value;
}
`;

const brokenFirstFix = `export function reverseString(value) {
  return value.split("").join("");
}
`;

const fixedUtils = `export function reverseString(value) {
  return value.split("").reverse().join("");
}
`;

const testScript = `import { reverseString } from "./utils.mjs";
import assert from "node:assert";

assert.strictEqual(reverseString("abc"), "cba");
console.log("Test Files  1 passed (1)");
console.log("      Tests  1 passed (1)");
console.log("   Duration  0.1s");
`;

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 6,
  workingDirectory: "",
  autoApprove: true,
  testCommand: "node utils.test.mjs",
  maxRetries: 3,
  verbose: false,
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

describe("P2-W7 self-fix end-to-end", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-w7-e2e-"));
    await writeFile(path.join(tempDir, "utils.mjs"), buggyUtils, "utf8");
    await writeFile(path.join(tempDir, "utils.test.mjs"), testScript, "utf8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("feeds failing tests back and repairs the bug within three attempts", async () => {
    const registry = createDefaultToolRegistry(tempDir);
    const responses = [
      toolCallResponse([
        {
          id: "read-test",
          name: "read_file",
          args: { path: "utils.test.mjs" },
        },
      ]),
      toolCallResponse([
        {
          id: "read-impl",
          name: "read_file",
          args: { path: "utils.mjs" },
        },
      ]),
      toolCallResponse([
        {
          id: "bad-edit",
          name: "edit_file",
          args: {
            path: "utils.mjs",
            old_string: buggyUtils,
            new_string: brokenFirstFix,
          },
        },
      ]),
      toolCallResponse([
        {
          id: "fix-edit",
          name: "edit_file",
          args: {
            path: "utils.mjs",
            old_string: brokenFirstFix,
            new_string: fixedUtils,
          },
        },
      ]),
      textResponse("reverseString 已修复。"),
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
      "修复 reverseString，并在失败时继续修复",
      { ...baseConfig, workingDirectory: tempDir },
      registry,
      client
    );

    await expect(readFile(path.join(tempDir, "utils.mjs"), "utf8")).resolves.toBe(
      fixedUtils
    );
    expect(result.success).toBe(true);
    expect(result.toolsCalled).toEqual([
      "read_file",
      "read_file",
      "edit_file",
      "edit_file",
    ]);

    const failureSeen = sentMessages.some((messages) =>
      messages.some((message) =>
        (message.content ?? "").includes("Tests failed. Please fix the issues")
      )
    );
    const passSeen = sentMessages.some((messages) =>
      messages.some((message) =>
        (message.content ?? "").includes("[verification] All tests passed")
      )
    );

    expect(failureSeen).toBe(true);
    expect(passSeen).toBe(true);
  });
});
