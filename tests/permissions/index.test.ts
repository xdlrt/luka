import { describe, expect, it, vi } from "vitest";
import type { PermissionIO } from "../../src/permissions/index.js";
import { requestPermission } from "../../src/permissions/index.js";

function createMockIO(answer: string): PermissionIO & {
  write: ReturnType<typeof vi.fn<[string], void>>;
  question: ReturnType<typeof vi.fn<[string], Promise<string>>>;
} {
  return {
    write: vi.fn<[string], void>(),
    question: vi.fn<[string], Promise<string>>().mockResolvedValue(answer),
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
      "[PERMISSION] Run command: npm test\n"
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
});
