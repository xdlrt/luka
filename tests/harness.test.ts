import { describe, expect, it, vi } from "vitest";
import { Harness } from "../src/harness.js";
import { ToolRegistry, type ToolDefinition } from "../src/tools/index.js";
import type { TestResult } from "../src/verification/test-runner.js";

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createHarness(
  overrides: Partial<ConstructorParameters<typeof Harness>[0]> = {}
): Harness {
  return new Harness({
    workingDirectory: "/tmp",
    autoApprove: false,
    maxRetries: 3,
    logger: silentLogger,
    ...overrides,
  });
}

function createTool(
  name: string,
  category: ToolDefinition["category"],
  output = "ok"
): ToolDefinition {
  return {
    name,
    category,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output })),
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

describe("Harness", () => {
  it("executes an approved tool through the registry", async () => {
    const registry = new ToolRegistry();
    const readFile = createTool("read_file", "read", "file content");
    registry.register(readFile);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = createHarness({ permissionCheck });

    const result = await harness.executeTool(
      "read_file",
      { path: "notes.txt" },
      registry,
      "tools: read_file"
    );

    expect(result).toEqual({ content: "file content" });
    expect(permissionCheck).toHaveBeenCalledWith(
      readFile,
      { path: "notes.txt" },
      { autoApprove: false }
    );
    expect(readFile.execute).toHaveBeenCalledWith({ path: "notes.txt" });
  });

  it("reports unknown tools without checking permission", async () => {
    const registry = new ToolRegistry();
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = createHarness({ permissionCheck });

    const result = await harness.executeTool(
      "missing",
      {},
      registry,
      "tools: missing"
    );

    expect(result).toEqual({ content: "[error] Tool not found: missing" });
    expect(permissionCheck).not.toHaveBeenCalled();
  });

  it("blocks sandbox escapes before permission or execution", async () => {
    const registry = new ToolRegistry();
    const readFile = createTool("read_file", "read", "secret");
    registry.register(readFile);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = createHarness({ permissionCheck });

    const result = await harness.executeTool(
      "read_file",
      { path: "../../etc/passwd" },
      registry,
      "tools: read_file"
    );

    expect(result).toEqual({
      content: "[blocked] path escapes the working directory",
    });
    expect(permissionCheck).not.toHaveBeenCalled();
    expect(readFile.execute).not.toHaveBeenCalled();
  });

  it("blocks dangerous commands before permission or execution", async () => {
    const registry = new ToolRegistry();
    const runCommand = createTool("run_command", "command", "deleted");
    registry.register(runCommand);
    const permissionCheck = vi.fn(async () => ({ approved: true as const }));
    const harness = createHarness({ permissionCheck, autoApprove: true });

    const result = await harness.executeTool(
      "run_command",
      { command: "sudo npm install" },
      registry,
      "tools: run_command"
    );

    expect(result).toEqual({
      content: "[blocked] Blocked: privilege escalation (sudo)",
    });
    expect(permissionCheck).not.toHaveBeenCalled();
    expect(runCommand.execute).not.toHaveBeenCalled();
  });

  it("reports permission denial without executing the tool", async () => {
    const registry = new ToolRegistry();
    const writeFile = createTool("write_file", "write", "wrote");
    registry.register(writeFile);
    const permissionCheck = vi.fn(async () => ({
      approved: false as const,
      reason: "Cancelled by user",
    }));
    const harness = createHarness({ permissionCheck });

    const result = await harness.executeTool(
      "write_file",
      { path: "notes.txt", content: "hello" },
      registry,
      "tools: write_file"
    );

    expect(result).toEqual({
      content: "[permission denied] Cancelled by user",
    });
    expect(writeFile.execute).not.toHaveBeenCalled();
  });

  it("formats tool errors and skips verification", async () => {
    const registry = new ToolRegistry();
    const editFile = {
      ...createTool("edit_file", "write"),
      execute: vi.fn(async () => ({
        tool_call_id: "edit_file",
        output: "not edited",
        error: "old string not found",
      })),
    };
    registry.register(editFile);
    const testRunner = vi.fn(async () => testResult(false));
    const harness = createHarness({
      autoApprove: true,
      testCommand: "npm test",
      testRunner,
    });

    const result = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );

    expect(result).toEqual({
      content: "not edited\n[error] old string not found",
    });
    expect(testRunner).not.toHaveBeenCalled();
  });

  it("runs verification after a successful edit", async () => {
    const registry = new ToolRegistry();
    registry.register(createTool("edit_file", "write"));
    const testRunner = vi.fn(async () => testResult(true));
    const harness = createHarness({
      autoApprove: true,
      testCommand: "npm test",
      testRunner,
    });

    const result = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );

    expect(testRunner).toHaveBeenCalledWith("npm test", "/tmp");
    expect(result.verificationMessage).toContain(
      "[verification] All tests passed"
    );
  });

  it("feeds failed verification back and stops at maxRetries", async () => {
    const registry = new ToolRegistry();
    registry.register(createTool("edit_file", "write"));
    const testRunner = vi.fn(async () => testResult(false));
    const harness = createHarness({
      autoApprove: true,
      testCommand: "npm test",
      maxRetries: 2,
      testRunner,
    });

    const first = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );
    const second = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );

    expect(first.verificationMessage).toContain(
      "Tests failed. Please fix the issues"
    );
    expect(second.verificationMessage).toBe("Unable to fix after 2 attempts");
  });

  it("resets retry state when a turn has no successful edits", async () => {
    const registry = new ToolRegistry();
    registry.register(createTool("edit_file", "write"));
    registry.register(createTool("read_file", "read", "content"));
    const testRunner = vi.fn(async () => testResult(false));
    const harness = createHarness({
      autoApprove: true,
      testCommand: "npm test",
      maxRetries: 2,
      testRunner,
    });

    const first = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );
    harness.endTurn();
    harness.beginTurn();
    await harness.executeTool(
      "read_file",
      { path: "add.ts" },
      registry,
      "tools: read_file"
    );
    harness.endTurn();
    harness.beginTurn();
    const second = await harness.executeTool(
      "edit_file",
      { path: "add.ts" },
      registry,
      "tools: edit_file"
    );

    expect(first.verificationMessage).toContain("Tests failed");
    expect(second.verificationMessage).toContain("Tests failed");
    expect(second.verificationMessage).not.toBe("Unable to fix after 2 attempts");
  });
});
