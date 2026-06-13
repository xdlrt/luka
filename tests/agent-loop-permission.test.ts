import { describe, expect, it, vi } from "vitest";
import {
  runAgentLoop,
  type PermissionChecker,
} from "../src/agent-loop.js";
import type { LLMClient } from "../src/llm-client.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
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

function createTool(
  name: string,
  category: ToolDefinition["category"],
  output: string
): ToolDefinition {
  return {
    name,
    category,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output })),
  };
}

function createClient(responses: ChatCompletionResponse[]): {
  client: LLMClient;
  sentMessages: Message[][];
} {
  const sentMessages: Message[][] = [];
  let index = 0;
  const sendMessage = vi.fn(async (messages: Message[]) => {
    sentMessages.push(messages.map((message) => ({ ...message })));
    const response = responses[index];
    index += 1;
    if (response === undefined) throw new Error("no more mock responses");
    return response;
  });

  return {
    client: { sendMessage } as unknown as LLMClient,
    sentMessages,
  };
}

function approve(): PermissionChecker {
  return vi.fn(async () => ({ approved: true }));
}

function reject(reason = "Cancelled by user"): PermissionChecker {
  return vi.fn(async () => ({ approved: false, reason }));
}

describe("runAgentLoop permission integration", () => {
  it("checks permission before executing an approved read tool", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        { id: "call-read", name: "read_file", args: { path: "notes.txt" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    const readFile = createTool("read_file", "read", "file content");
    tools.register(readFile);
    const permissionCheck = approve();

    const result = await runAgentLoop(
      "read notes",
      baseConfig,
      tools,
      client,
      permissionCheck
    );

    expect(result.success).toBe(true);
    expect(permissionCheck).toHaveBeenCalledWith(readFile, {
      path: "notes.txt",
    });
    expect(readFile.execute).toHaveBeenCalledWith({ path: "notes.txt" });
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-read",
      content: "file content",
    });
  });

  it("executes write_file when permission is approved", async () => {
    const input = { path: "notes.txt", content: "hello" };
    const { client } = createClient([
      toolCallResponse([{ id: "call-write", name: "write_file", args: input }]),
      textResponse("written"),
    ]);
    const tools = new ToolRegistry();
    const writeFile = createTool("write_file", "write", "wrote file");
    tools.register(writeFile);
    const permissionCheck = approve();

    await runAgentLoop("write notes", baseConfig, tools, client, permissionCheck);

    expect(permissionCheck).toHaveBeenCalledWith(writeFile, input);
    expect(writeFile.execute).toHaveBeenCalledWith(input);
  });

  it("skips write_file when permission is rejected and reports it to the model", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-write",
          name: "write_file",
          args: { path: "notes.txt", content: "hello" },
        },
      ]),
      textResponse("cancelled"),
    ]);
    const tools = new ToolRegistry();
    const writeFile = createTool("write_file", "write", "wrote file");
    tools.register(writeFile);
    const permissionCheck = reject();

    const result = await runAgentLoop(
      "write notes",
      baseConfig,
      tools,
      client,
      permissionCheck
    );

    expect(result.success).toBe(true);
    expect(writeFile.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-write",
      content: "[permission denied] Cancelled by user",
    });
  });

  it("skips run_command when permission is rejected and continues the loop", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-run",
          name: "run_command",
          args: { command: "npm test" },
        },
      ]),
      textResponse("I will not run it."),
    ]);
    const tools = new ToolRegistry();
    const runCommand = createTool("run_command", "command", "tests passed");
    tools.register(runCommand);

    const result = await runAgentLoop(
      "run tests",
      baseConfig,
      tools,
      client,
      reject()
    );

    expect(result.finalMessage).toBe("I will not run it.");
    expect(runCommand.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-run",
      content: "[permission denied] Cancelled by user",
    });
  });

  it("does not check permission for unknown tools and reports the error", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([{ id: "call-missing", name: "missing", args: {} }]),
      textResponse("missing handled"),
    ]);
    const tools = new ToolRegistry();
    const permissionCheck = approve();

    const result = await runAgentLoop(
      "use missing",
      baseConfig,
      tools,
      client,
      permissionCheck
    );

    expect(result.success).toBe(true);
    expect(permissionCheck).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-missing",
      content: "[error] Tool not found: missing",
    });
  });

  it("checks each tool call independently when approvals and rejections are mixed", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        { id: "call-read", name: "read_file", args: { path: "notes.txt" } },
        {
          id: "call-write",
          name: "write_file",
          args: { path: "notes.txt", content: "new" },
        },
      ]),
      textResponse("mixed done"),
    ]);
    const tools = new ToolRegistry();
    const readFile = createTool("read_file", "read", "old");
    const writeFile = createTool("write_file", "write", "new");
    tools.register(readFile);
    tools.register(writeFile);
    const permissionCheck: PermissionChecker = vi.fn(async (tool) =>
      tool.name === "read_file"
        ? { approved: true }
        : { approved: false, reason: "Cancelled by user" }
    );

    await runAgentLoop("mix", baseConfig, tools, client, permissionCheck);

    expect(permissionCheck).toHaveBeenCalledTimes(2);
    expect(readFile.execute).toHaveBeenCalledWith({ path: "notes.txt" });
    expect(writeFile.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].filter((message) => message.role === "tool")).toEqual(
      [
        {
          role: "tool",
          tool_call_id: "call-read",
          content: "old",
        },
        {
          role: "tool",
          tool_call_id: "call-write",
          content: "[permission denied] Cancelled by user",
        },
      ]
    );
  });
});
