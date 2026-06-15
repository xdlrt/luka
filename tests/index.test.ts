import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import {
  handleUserInput,
  isCliEntrypoint,
  parseCliArgs,
  runCli,
} from "../src/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import type { AppConfig } from "../src/config.js";

const baseConfig: AppConfig = {
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
    otel: {
      enabled: false,
      serviceName: "coding-agent",
      timeoutMs: 3000,
    },
  },
};

describe("parseCliArgs", () => {
  it("extracts --auto-approve without sending it as user input", () => {
    expect(parseCliArgs(["--auto-approve", "edit", "file"])).toEqual({
      autoApprove: true,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "edit file",
    });
  });

  it("treats -y as an alias for --auto-approve", () => {
    expect(parseCliArgs(["-y", "run", "tests"])).toEqual({
      autoApprove: true,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "run tests",
    });
  });

  it("keeps autoApprove disabled when the flag is absent", () => {
    expect(parseCliArgs(["hello", "agent"])).toEqual({
      autoApprove: false,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "hello agent",
    });
  });

  it("returns empty input when only auto-approve is provided", () => {
    expect(parseCliArgs(["--auto-approve"])).toEqual({
      autoApprove: true,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "",
    });
  });

  it("captures --test-command value without sending it as user input", () => {
    expect(parseCliArgs(["--test-command", "npm test", "fix", "bug"])).toEqual({
      autoApprove: false,
      testCommand: "npm test",
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "fix bug",
    });
  });

  it("throws when --test-command has no value", () => {
    expect(() => parseCliArgs(["--test-command"])).toThrow(
      /--test-command requires a value/
    );
  });

  it("captures --max-retries value without sending it as user input", () => {
    expect(parseCliArgs(["--max-retries", "2", "fix", "bug"])).toEqual({
      autoApprove: false,
      testCommand: undefined,
      maxRetries: 2,
      verbose: false,
      hooksConfigPath: undefined,
      initialInput: "fix bug",
    });
  });

  it("throws when --max-retries is missing or invalid", () => {
    expect(() => parseCliArgs(["--max-retries"])).toThrow(
      /--max-retries requires a value/
    );
    expect(() => parseCliArgs(["--max-retries", "0"])).toThrow(
      /--max-retries requires a positive integer/
    );
    expect(() => parseCliArgs(["--max-retries", "1.5"])).toThrow(
      /--max-retries requires a positive integer/
    );
  });

  it("captures verbose flags without sending them as user input", () => {
    expect(parseCliArgs(["--verbose", "fix"])).toEqual({
      autoApprove: false,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: true,
      hooksConfigPath: undefined,
      initialInput: "fix",
    });
    expect(parseCliArgs(["-v", "fix"])).toEqual({
      autoApprove: false,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: true,
      hooksConfigPath: undefined,
      initialInput: "fix",
    });
  });

  it("captures --hooks-config value without sending it as user input", () => {
    expect(parseCliArgs(["--hooks-config", "hooks.json", "run"])).toEqual({
      autoApprove: false,
      testCommand: undefined,
      maxRetries: undefined,
      verbose: false,
      hooksConfigPath: "hooks.json",
      initialInput: "run",
    });
  });

  it("throws when --hooks-config has no value", () => {
    expect(() => parseCliArgs(["--hooks-config"])).toThrow(
      /--hooks-config requires a value/
    );
  });
});

describe("isCliEntrypoint", () => {
  it("matches direct script execution", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "coding-agent-entry-"));
    const script = path.join(dir, "index.js");
    writeFileSync(script, "#!/usr/bin/env node\n");

    expect(isCliEntrypoint(script, pathToFileURL(script).href)).toBe(true);
  });

  it("matches npm bin symlinks to the built entrypoint", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "coding-agent-entry-"));
    const script = path.join(dir, "index.js");
    const link = path.join(dir, "coding-agent");
    writeFileSync(script, "#!/usr/bin/env node\n");
    symlinkSync(script, link);

    expect(isCliEntrypoint(link, pathToFileURL(script).href)).toBe(true);
  });

  it("does not match imports from another entrypoint", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "coding-agent-entry-"));
    const script = path.join(dir, "index.js");
    const other = path.join(dir, "other.js");
    writeFileSync(script, "#!/usr/bin/env node\n");
    writeFileSync(other, "#!/usr/bin/env node\n");

    expect(isCliEntrypoint(other, pathToFileURL(script).href)).toBe(false);
  });
});

describe("package scripts", () => {
  it("exposes the built CLI as a package binary", () => {
    expect(packageJson.bin).toEqual({
      "coding-agent": "dist/index.js",
    });
  });

  it("limits npm package contents to release artifacts", () => {
    expect(packageJson.files).toEqual([
      "dist",
      "docs/demo.cast",
      "README.md",
      "LICENSE",
      "CONTRIBUTING.md",
    ]);
  });

  it("provides a quick start command for the CLI entrypoint", () => {
    expect(packageJson.scripts.start).toBe(
      "npm run build && node dist/index.js"
    );
  });

  it("provides a mock eval command that does not require model credentials", () => {
    expect(packageJson.scripts["eval:mock"]).toBe(
      "npm run build && node dist/evals/runner.js --suite smoke --mock"
    );
  });
});

describe("runCli", () => {
  it("launches the Ink TUI when no initial input is provided", async () => {
    vi.stubEnv("ARK_API_KEY", "key-123");
    vi.stubEnv("ARK_MODEL", "doubao-test");
    const tuiRunner = vi.fn(async () => undefined);

    await runCli([], tuiRunner);

    expect(tuiRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "key-123",
        model: "doubao-test",
      }),
      expect.any(ToolRegistry)
    );
  });

  it("keeps one-shot task execution outside the TUI", async () => {
    vi.stubEnv("ARK_API_KEY", "key-123");
    vi.stubEnv("ARK_MODEL", "doubao-test");
    const tuiRunner = vi.fn(async () => undefined);
    const writeLine = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: "doubao-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "done" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
    } as Response));
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await runCli(["hello"], tuiRunner);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(tuiRunner).not.toHaveBeenCalled();
    expect(writeLine).toHaveBeenCalledWith("done");
  });
});

describe("handleUserInput", () => {
  it("ignores empty input and keeps the REPL running", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn();

    const shouldContinue = await handleUserInput(
      "   ",
      baseConfig,
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(shouldContinue).toBe(true);
    expect(runner).not.toHaveBeenCalled();
    expect(writeLine).not.toHaveBeenCalled();
  });

  it("returns false for .exit", async () => {
    const shouldContinue = await handleUserInput(
      ".exit",
      baseConfig,
      new ToolRegistry(),
      vi.fn(),
      vi.fn()
    );

    expect(shouldContinue).toBe(false);
  });

  it("runs the agent and prints the final message", async () => {
    const registry = new ToolRegistry();
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
      todoDisplay: undefined,
    }));

    const shouldContinue = await handleUserInput(
      "  hello  ",
      baseConfig,
      registry,
      writeLine,
      runner
    );

    expect(shouldContinue).toBe(true);
    expect(runner).toHaveBeenCalledWith(
      "hello",
      baseConfig,
      registry,
      expect.any(Object)
    );
    expect(writeLine).toHaveBeenCalledWith("done");
  });

  it("prints tools called when the agent used tools", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "updated",
      turnsUsed: 2,
      toolsCalled: ["read_file", "write_file"],
      success: true,
      totalTokens: 4,
      todoDisplay: undefined,
    }));

    await handleUserInput(
      "edit file",
      baseConfig,
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(writeLine).toHaveBeenCalledWith("updated");
    expect(writeLine).toHaveBeenCalledWith(
      "[CLI] Tools called: read_file, write_file"
    );
  });

  it("prints a max-turns message when the agent reports failure", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "partial",
      turnsUsed: 3,
      toolsCalled: ["run_command"],
      success: false,
      totalTokens: 6,
      todoDisplay: undefined,
    }));

    await handleUserInput(
      "try task",
      { ...baseConfig, maxTurns: 3 },
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(writeLine).toHaveBeenCalledWith("[CLI] Stopped after 3 turns");
  });

  it("prints todo display when the agent reports a plan", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "updated",
      turnsUsed: 2,
      toolsCalled: ["todo_write"],
      success: true,
      totalTokens: 4,
      todoDisplay: [
        "Progress: 1/2 completed",
        "[x] Inspect code",
        "[~] Implement tool",
      ].join("\n"),
    }));

    await handleUserInput(
      "plan task",
      baseConfig,
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(writeLine).toHaveBeenCalledWith("updated");
    expect(writeLine).toHaveBeenCalledWith(
      [
        "Progress: 1/2 completed",
        "[x] Inspect code",
        "[~] Implement tool",
      ].join("\n")
    );
    expect(writeLine).toHaveBeenCalledWith("[CLI] Tools called: todo_write");
  });

  it("does not print todo display when no plan exists", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
      todoDisplay: undefined,
    }));

    await handleUserInput(
      "simple task",
      baseConfig,
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(writeLine).toHaveBeenCalledTimes(1);
    expect(writeLine).toHaveBeenCalledWith("done");
  });

  it("prints errors and keeps the REPL running when the agent throws", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => {
      throw new Error("boom");
    });

    const shouldContinue = await handleUserInput(
      "fail",
      baseConfig,
      new ToolRegistry(),
      writeLine,
      runner
    );

    expect(shouldContinue).toBe(true);
    expect(writeLine).toHaveBeenCalledWith("Error: boom");
  });
});
