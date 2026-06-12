import { describe, expect, it } from "vitest";
import { createRunCommandTool } from "../../src/tools/run-command.js";

describe("createRunCommandTool", () => {
  it("defines the run_command tool schema", () => {
    const tool = createRunCommandTool(process.cwd());

    expect(tool.name).toBe("run_command");
    expect(tool.category).toBe("command");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    });
  });

  it("runs a successful command and returns stdout", async () => {
    const tool = createRunCommandTool(process.cwd());

    const result = await tool.execute({ command: "echo hello" });

    expect(result.tool_call_id).toBe("run_command");
    expect(result.error).toBeUndefined();
    expect(result.output).toMatch(/hello/);
  });

  it("returns an error with exit code on command failure", async () => {
    const tool = createRunCommandTool(process.cwd());

    const result = await tool.execute({
      command: 'node -e "process.exit(3)"',
    });

    expect(result.tool_call_id).toBe("run_command");
    expect(result.error).toMatch(/exit code: 3/);
  });

  it("captures stderr on command failure", async () => {
    const tool = createRunCommandTool(process.cwd());

    const result = await tool.execute({
      command: 'node -e "console.error(\'boom\'); process.exit(1)"',
    });

    expect(result.error).toMatch(/boom/);
    expect(result.error).toMatch(/exit code: 1/);
  });

  it("returns a timeout error when the command exceeds timeoutMs", async () => {
    const tool = createRunCommandTool(process.cwd(), { timeoutMs: 100 });

    const result = await tool.execute({ command: "sleep 5" });

    expect(result.tool_call_id).toBe("run_command");
    expect(result.error).toMatch(/timed out after 100ms/);
  });

  it("returns an error when command is missing or invalid", async () => {
    const tool = createRunCommandTool(process.cwd());

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "run_command",
      output: "",
      error: expect.stringMatching(/non-empty string command/),
    });
    await expect(tool.execute({ command: 123 })).resolves.toMatchObject({
      error: expect.stringMatching(/non-empty string command/),
    });
    await expect(tool.execute({ command: "   " })).resolves.toMatchObject({
      error: expect.stringMatching(/non-empty string command/),
    });
  });
});
