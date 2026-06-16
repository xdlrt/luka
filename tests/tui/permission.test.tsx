import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render as inkRender } from "ink-testing-library";
import {
  DEFAULT_OBSERVABILITY_DIR,
  OTEL_SERVICE_NAME,
} from "../../src/brand.js";
import { TuiApp, type TuiSessionRunner } from "../../src/tui/app.js";
import type { AppConfig } from "../../src/config.js";
import { ToolRegistry } from "../../src/tools/index.js";
import type { ToolDefinition } from "../../src/tools/types.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 1,
  workingDirectory: "/tmp/project",
  autoApprove: false,
  maxRetries: 3,
  verbose: false,
  observability: {
    localDir: DEFAULT_OBSERVABILITY_DIR,
    feedback: {
      enabled: false,
      timeoutMs: 3000,
      batchSize: 20,
    },
    otel: {
      enabled: false,
      serviceName: OTEL_SERVICE_NAME,
      timeoutMs: 3000,
    },
  },
};

const instances: Array<ReturnType<typeof inkRender>> = [];

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
  vi.restoreAllMocks();
});

describe("TuiApp permission flow", () => {
  it("approves write tools with inline y/n input", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ output: "wrote file" }));
    registry.register(createTool("write_file", "write", execute));
    const runner = createPermissionRunner("write_file", {
      path: "note.txt",
      content: "hello\nworld",
    });
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={registry}
        sessionRunner={runner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "write");
    await waitFor(() =>
      expect(frame(instance)).toContain("Do you want to proceed? y/n")
    );
    await waitForPermissionReady(instance);

    instance.stdin.write("y");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(execute).toHaveBeenCalledWith({
      path: "note.txt",
      content: "hello\nworld",
    });
    expect(frame(instance)).toContain("[PERMISSION] Approved write_file");
  });

  it("denies write tools with inline n input", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ output: "wrote file" }));
    registry.register(createTool("write_file", "write", execute));
    const runner = createPermissionRunner("write_file", {
      path: "note.txt",
      content: "hello",
    });
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={registry}
        sessionRunner={runner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "write");
    await waitFor(() =>
      expect(frame(instance)).toContain("Do you want to proceed? y/n")
    );
    await waitForPermissionReady(instance);

    instance.stdin.write("n");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(execute).not.toHaveBeenCalled();
    expect(frame(instance)).toContain("[PERMISSION] Denied write_file");
  });

  it("denies write tools with escape", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ output: "wrote file" }));
    registry.register(createTool("write_file", "write", execute));
    const runner = createPermissionRunner("write_file", {
      path: "note.txt",
      content: "hello",
    });
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={registry}
        sessionRunner={runner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "write");
    await waitForPermissionReady(instance);

    instance.stdin.write("\u001B");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(execute).not.toHaveBeenCalled();
    expect(frame(instance)).toContain("[PERMISSION] Denied write_file");
  });

  it("auto-approves non-read tools when autoApprove is enabled", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ output: "command ok" }));
    registry.register(createTool("run_command", "command", execute));
    const runner = createPermissionRunner("run_command", {
      command: "node -v",
    });
    const instance = render(
      <TuiApp
        config={{ ...baseConfig, autoApprove: true }}
        registry={registry}
        sessionRunner={runner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "run");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(execute).toHaveBeenCalledWith({ command: "node -v" });
    expect(frame(instance)).not.toContain("Proceed? y/n");
  });
});

function render(tree: React.ReactElement): ReturnType<typeof inkRender> {
  const instance = inkRender(tree);
  instances.push(instance);
  return instance;
}

function createPermissionRunner(
  toolName: string,
  input: Record<string, unknown>
): TuiSessionRunner {
  return async (
    _userInput: string,
    config: AppConfig,
    registry: ToolRegistry,
    options
  ) => {
    const tool = registry.get(toolName);
    if (tool === undefined) {
      throw new Error(`missing tool ${toolName}`);
    }
    const decision = await options.harnessConfig?.permissionCheck?.(
      tool,
      input,
      { autoApprove: config.autoApprove }
    );
    if (decision?.approved === false) {
      return {
        finalMessage: `done: [permission denied] ${decision.reason}`,
        turnsUsed: 1,
        toolsCalled: [toolName],
        success: true,
        totalTokens: 1,
        todoDisplay: undefined,
      };
    }
    const result = await tool.execute(input);
    return {
      finalMessage: `done: ${result.output}`,
      turnsUsed: 1,
      toolsCalled: [toolName],
      success: true,
      totalTokens: 1,
      todoDisplay: undefined,
    };
  };
}

function createTool(
  name: string,
  category: ToolDefinition["category"],
  execute: ToolDefinition["execute"]
): ToolDefinition {
  return {
    name,
    description: name,
    parameters: {
      type: "object",
      additionalProperties: true,
    },
    category,
    execute,
  };
}

function frame(instance: { lastFrame(): string | undefined }): string {
  return instance.lastFrame() ?? "";
}

async function waitForInputReady(instance: {
  lastFrame(): string | undefined;
}): Promise<void> {
  await waitFor(() => expect(frame(instance)).toContain(">"));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function waitForPermissionReady(instance: {
  lastFrame(): string | undefined;
}): Promise<void> {
  await waitFor(() =>
    expect(frame(instance)).toContain("Do you want to proceed? y/n")
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function typeAndSubmit(
  instance: {
    stdin: { write(input: string): void };
    lastFrame(): string | undefined;
  },
  input: string
): Promise<void> {
  instance.stdin.write(input);
  await waitFor(() => expect(frame(instance)).toContain(`> ${input}`));
  instance.stdin.write("\r");
}

async function waitFor(assertion: () => void): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Timed out waiting for assertion");
}
