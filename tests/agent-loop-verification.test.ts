import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import { Harness } from "../src/harness.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import type { AppConfig } from "../src/config.js";
import type { TestResult } from "../src/verification/test-runner.js";
import {
  baseConfig as defaultBaseConfig,
  createClient,
  textResponse,
  toolCallResponse,
} from "./test-helpers.js";

const baseConfig: AppConfig = {
  ...defaultBaseConfig,
  autoApprove: true,
  testCommand: "npm test",
};

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

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
    const { client, sentMessages } = createClient([
      toolCallResponse([
        { id: "c1", name: "edit_file", args: { path: "a.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => passingResult());
    const harness = Harness.fromAppConfig(baseConfig, {
      testRunner,
      logger: silentLogger,
    });

    await runAgentLoop(
      "fix",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(testRunner).toHaveBeenCalledWith("npm test", "/tmp");
    const secondTurn = sentMessages[1];
    const verification = secondTurn.find(
      (m) =>
        m.role === "assistant" && (m.content ?? "").includes("[verification]")
    );
    expect(verification?.content).toContain(
      "All tests passed (2 tests in 1 file, 0.5s)"
    );
  });

  it("skips verification when no testCommand is configured", async () => {
    const { client } = createClient([
      toolCallResponse([
        { id: "c1", name: "edit_file", args: { path: "a.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => passingResult());
    const config = { ...baseConfig, testCommand: undefined };
    const harness = Harness.fromAppConfig(config, {
      testRunner,
      logger: silentLogger,
    });

    await runAgentLoop("fix", config, tools, client, harness, silentLogger);

    expect(testRunner).not.toHaveBeenCalled();
  });

  it("does not run tests when only a non-edit tool was used", async () => {
    const { client } = createClient([
      toolCallResponse([
        { id: "c1", name: "read_file", args: { path: "a.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("read_file"));
    const testRunner = vi.fn(async () => passingResult());
    const harness = Harness.fromAppConfig(baseConfig, {
      testRunner,
      logger: silentLogger,
    });

    await runAgentLoop("read", baseConfig, tools, client, harness, silentLogger);

    expect(testRunner).not.toHaveBeenCalled();
  });
});
