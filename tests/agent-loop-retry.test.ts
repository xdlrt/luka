import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../src/agent-loop.js";
import type { AppConfig } from "../src/config.js";
import { Harness } from "../src/harness.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
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
    const { client, sentMessages } = createClient([
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
    const harness = Harness.fromAppConfig(baseConfig, {
      testRunner,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "fix add",
      baseConfig,
      tools,
      client,
      harness,
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
    const { client, sentMessages } = createClient([
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
    const config = { ...baseConfig, maxRetries: 2 };
    const harness = Harness.fromAppConfig(config, {
      testRunner,
      logger: silentLogger,
    });

    const result = await runAgentLoop(
      "fix add",
      config,
      tools,
      client,
      harness,
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
    const { client } = createClient([
      toolCallResponse([
        { id: "edit-1", name: "edit_file", args: { path: "add.ts" } },
      ]),
      textResponse("done"),
    ]);
    const tools = new ToolRegistry();
    tools.register(createTool("edit_file"));
    const testRunner = vi.fn(async () => testResult(false));
    const config = { ...baseConfig, testCommand: undefined };
    const harness = Harness.fromAppConfig(config, {
      testRunner,
      logger: silentLogger,
    });

    await runAgentLoop(
      "fix add",
      config,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(testRunner).not.toHaveBeenCalled();
  });

  it("does not run verification when an edit tool returns an error", async () => {
    const { client } = createClient([
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
    const harness = Harness.fromAppConfig(baseConfig, {
      testRunner,
      logger: silentLogger,
    });

    await runAgentLoop(
      "fix add",
      baseConfig,
      tools,
      client,
      harness,
      silentLogger
    );

    expect(testRunner).not.toHaveBeenCalled();
  });
});
