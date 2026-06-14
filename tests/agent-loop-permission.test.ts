import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import { Harness } from "../src/harness.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import {
  baseConfig,
  createClient,
  textResponse,
  toolCallResponse,
} from "./test-helpers.js";

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

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

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
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "read notes",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(result.success).toBe(true);
    expect(permissionCheck).toHaveBeenCalledWith(
      readFile,
      { path: "notes.txt" },
      { autoApprove: false }
    );
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
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "write notes",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(permissionCheck).toHaveBeenCalledWith(writeFile, input, {
      autoApprove: false,
    });
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
    const permissionCheck = vi.fn(async () => ({
      approved: false as const,
      reason: "Cancelled by user",
    }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "write notes",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
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
    const permissionCheck = vi.fn(async () => ({
      approved: false as const,
      reason: "Cancelled by user",
    }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "run tests",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
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
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "use missing",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
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
    const permissionCheck = vi.fn(async (tool: ToolDefinition) =>
      tool.name === "read_file"
        ? { approved: true }
        : { approved: false, reason: "Cancelled by user" }
    );
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "mix",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

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

  it("blocks read_file sandbox escapes before permission or execution", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-read",
          name: "read_file",
          args: { path: "../../etc/passwd" },
        },
      ]),
      textResponse("blocked"),
    ]);
    const tools = new ToolRegistry();
    const readFile = createTool("read_file", "read", "secret");
    tools.register(readFile);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "read outside",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(permissionCheck).not.toHaveBeenCalled();
    expect(readFile.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-read",
      content: "[blocked] path escapes the working directory",
    });
  });

  it("blocks dangerous run_command before permission or execution", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-run",
          name: "run_command",
          args: { command: "rm -rf /tmp/test" },
        },
      ]),
      textResponse("blocked"),
    ]);
    const tools = new ToolRegistry();
    const runCommand = createTool("run_command", "command", "deleted");
    tools.register(runCommand);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "delete",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(permissionCheck).not.toHaveBeenCalled();
    expect(runCommand.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-run",
      content: "[blocked] Blocked: destructive file deletion (rm -rf)",
    });
  });

  it("still asks permission for safe write_file calls", async () => {
    const input = { path: "test.txt", content: "hello" };
    const { client, sentMessages } = createClient([
      toolCallResponse([{ id: "call-write", name: "write_file", args: input }]),
      textResponse("denied"),
    ]);
    const tools = new ToolRegistry();
    const writeFile = createTool("write_file", "write", "wrote file");
    tools.register(writeFile);
    const permissionCheck = vi.fn(async () => ({
      approved: false as const,
      reason: "Cancelled by user",
    }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "write",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(permissionCheck).toHaveBeenCalledWith(writeFile, input, {
      autoApprove: false,
    });
    expect(writeFile.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-write",
      content: "[permission denied] Cancelled by user",
    });
  });

  it("does not let autoApprove bypass dangerous command rules", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-run",
          name: "run_command",
          args: { command: "sudo npm install" },
        },
      ]),
      textResponse("blocked"),
    ]);
    const tools = new ToolRegistry();
    const runCommand = createTool("run_command", "command", "installed");
    tools.register(runCommand);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const config = { ...baseConfig, autoApprove: true };
    const harness = Harness.fromAppConfig(config, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "install",
      config,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(permissionCheck).not.toHaveBeenCalled();
    expect(runCommand.execute).not.toHaveBeenCalled();
    expect(sentMessages[1].find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call-run",
      content: "[blocked] Blocked: privilege escalation (sudo)",
    });
  });

  it("checks safety independently for mixed tool calls", async () => {
    const { client, sentMessages } = createClient([
      toolCallResponse([
        {
          id: "call-run",
          name: "run_command",
          args: { command: "rm -rf dist" },
        },
        {
          id: "call-read",
          name: "read_file",
          args: { path: "notes.txt" },
        },
      ]),
      textResponse("mixed"),
    ]);
    const tools = new ToolRegistry();
    const runCommand = createTool("run_command", "command", "deleted");
    const readFile = createTool("read_file", "read", "notes");
    tools.register(runCommand);
    tools.register(readFile);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = Harness.fromAppConfig(baseConfig, {
      permissionCheck,
      logger: silentLogger,
    });

    await runAgentLoop(
      "mix safety",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(runCommand.execute).not.toHaveBeenCalled();
    expect(readFile.execute).toHaveBeenCalledWith({ path: "notes.txt" });
    expect(permissionCheck).toHaveBeenCalledTimes(1);
    expect(permissionCheck).toHaveBeenCalledWith(
      readFile,
      { path: "notes.txt" },
      { autoApprove: false }
    );
    expect(sentMessages[1].filter((message) => message.role === "tool")).toEqual(
      [
        {
          role: "tool",
          tool_call_id: "call-run",
          content: "[blocked] Blocked: destructive file deletion (rm -rf)",
        },
        {
          role: "tool",
          tool_call_id: "call-read",
          content: "notes",
        },
      ]
    );
  });
});
