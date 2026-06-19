import { describe, expect, it, vi } from "vitest";
import {
  checkToolPermission,
  type PermissionIO,
} from "../../src/permissions/index.js";
import { requestPermission } from "../../src/permissions/index.js";
import type { ToolDefinition } from "../../src/tools/index.js";

function createMockIO(answer: string): PermissionIO & {
  write: ReturnType<typeof vi.fn<[string], void>>;
  question: ReturnType<typeof vi.fn<[string], Promise<string>>>;
} {
  return {
    write: vi.fn<[string], void>(),
    question: vi.fn<[string], Promise<string>>().mockResolvedValue(answer),
  };
}

function createTool(
  name: string,
  category?: ToolDefinition["category"]
): ToolDefinition {
  return {
    name,
    category,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ tool_call_id: name, output: "" })),
  };
}

describe("requestPermission", () => {
  it("approves read tools without prompting", async () => {
    const io = createMockIO("n");

    const decision = await requestPermission(
      {
        toolName: "read_file",
        category: "read",
        input: { path: "notes.txt" },
      },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.question).not.toHaveBeenCalled();
  });

  it("approves write_file when the user answers y", async () => {
    const io = createMockIO("y");

    const decision = await requestPermission(
      {
        toolName: "write_file",
        category: "write",
        input: {
          path: "src/example.ts",
          content: "line 1\nline 2\nline 3\nline 4",
        },
      },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Write file: src/example.ts\nContent preview: line 1\nline 2\nline 3...\n"
    );
    expect(io.question).toHaveBeenCalledWith("Proceed? (y/n) ");
  });

  it("rejects write_file when the user answers n", async () => {
    const io = createMockIO("n");

    const decision = await requestPermission(
      {
        toolName: "write_file",
        category: "write",
        input: { path: "README.md", content: "new content" },
      },
      io
    );

    expect(decision).toEqual({
      approved: false,
      reason: "Cancelled by user",
    });
  });

  it("approves run_command when the user answers uppercase y", async () => {
    const io = createMockIO("Y");

    const decision = await requestPermission(
      {
        toolName: "run_command",
        category: "command",
        input: { command: "npm test" },
      },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Run command: npm test\nClassification: unknown\nReason: npm test executes project scripts\n"
    );
    expect(io.question).toHaveBeenCalledWith("Proceed? (y/n) ");
  });

  it("rejects run_command when the user answers n", async () => {
    const io = createMockIO("n");

    const decision = await requestPermission(
      {
        toolName: "run_command",
        category: "command",
        input: { command: "npm test" },
      },
      io
    );

    expect(decision).toEqual({
      approved: false,
      reason: "Cancelled by user",
    });
  });

  it("rejects unexpected answers", async () => {
    const io = createMockIO("maybe");

    const decision = await requestPermission(
      {
        toolName: "run_command",
        category: "command",
        input: { command: "npm test" },
      },
      io
    );

    expect(decision).toEqual({
      approved: false,
      reason: "Cancelled by user",
    });
  });

  it("prints a stable preview for short content", async () => {
    const io = createMockIO("y");

    await requestPermission(
      {
        toolName: "write_file",
        category: "write",
        input: { path: "short.txt", content: "one line" },
      },
      io
    );

    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Write file: short.txt\nContent preview: one line...\n"
    );
  });

  it("prints a placeholder preview for non-string content", async () => {
    const io = createMockIO("y");

    await requestPermission(
      {
        toolName: "write_file",
        category: "write",
        input: { path: "bad.txt", content: 123 },
      },
      io
    );

    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Write file: bad.txt\nContent preview: <non-string content>...\n"
    );
  });

  it("prompts conservatively for unknown tools", async () => {
    const io = createMockIO("y");

    const decision = await requestPermission(
      {
        toolName: "custom_tool",
        category: "unknown",
        input: {},
      },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Execute tool: custom_tool\n"
    );
  });

  it("auto-approves write tools without prompting", async () => {
    const io = createMockIO("n");

    const decision = await requestPermission(
      {
        toolName: "write_file",
        category: "write",
        input: { path: "notes.txt", content: "hello" },
      },
      io,
      { autoApprove: true }
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.question).not.toHaveBeenCalled();
  });

  it("auto-approves command tools without prompting", async () => {
    const io = createMockIO("n");

    const decision = await requestPermission(
      {
        toolName: "run_command",
        category: "command",
        input: { command: "npm test" },
      },
      io,
      { autoApprove: true }
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.question).not.toHaveBeenCalled();
  });
});

describe("checkToolPermission", () => {
  it("uses the runtime tool category when it is present", async () => {
    const io = createMockIO("n");
    const tool = createTool("custom_reader", "read");

    const decision = await checkToolPermission(tool, { path: "notes.txt" }, io);

    expect(decision).toEqual({ approved: true });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.question).not.toHaveBeenCalled();
  });

  it("falls back to registered tool classification when category is missing", async () => {
    const io = createMockIO("y");
    const tool = createTool("write_file");

    const decision = await checkToolPermission(
      tool,
      { path: "notes.txt", content: "hello" },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Write file: notes.txt\nContent preview: hello...\n"
    );
  });

  it("prompts conservatively when the tool category is unknown", async () => {
    const io = createMockIO("n");
    const tool = createTool("custom_tool");

    const decision = await checkToolPermission(tool, {}, io);

    expect(decision).toEqual({
      approved: false,
      reason: "Cancelled by user",
    });
    expect(io.write).toHaveBeenCalledWith(
      "[PERMISSION] Execute tool: custom_tool\n"
    );
  });

  it("auto-approves through checkToolPermission without prompting", async () => {
    const io = createMockIO("n");
    const tool = createTool("run_command", "command");

    const decision = await checkToolPermission(
      tool,
      { command: "npm test" },
      { autoApprove: true },
      io
    );

    expect(decision).toEqual({ approved: true });
    expect(io.write).not.toHaveBeenCalled();
    expect(io.question).not.toHaveBeenCalled();
  });
});
