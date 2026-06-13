import { describe, expect, it, vi } from "vitest";
import { handleUserInput, parseCliArgs } from "../src/index.js";
import { ToolRegistry } from "../src/tools/index.js";
import type { AppConfig } from "../src/config.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
  autoApprove: false,
};

describe("parseCliArgs", () => {
  it("extracts --auto-approve without sending it as user input", () => {
    expect(parseCliArgs(["--auto-approve", "edit", "file"])).toEqual({
      autoApprove: true,
      initialInput: "edit file",
    });
  });

  it("treats -y as an alias for --auto-approve", () => {
    expect(parseCliArgs(["-y", "run", "tests"])).toEqual({
      autoApprove: true,
      initialInput: "run tests",
    });
  });

  it("keeps autoApprove disabled when the flag is absent", () => {
    expect(parseCliArgs(["hello", "agent"])).toEqual({
      autoApprove: false,
      initialInput: "hello agent",
    });
  });

  it("returns empty input when only auto-approve is provided", () => {
    expect(parseCliArgs(["--auto-approve"])).toEqual({
      autoApprove: true,
      initialInput: "",
    });
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
    }));

    const shouldContinue = await handleUserInput(
      "  hello  ",
      baseConfig,
      registry,
      writeLine,
      runner
    );

    expect(shouldContinue).toBe(true);
    expect(runner).toHaveBeenCalledWith("hello", baseConfig, registry);
    expect(writeLine).toHaveBeenCalledWith("done");
  });

  it("prints tools called when the agent used tools", async () => {
    const writeLine = vi.fn();
    const runner = vi.fn(async () => ({
      finalMessage: "updated",
      turnsUsed: 2,
      toolsCalled: ["read_file", "write_file"],
      success: true,
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
