import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "../../src/tools/index.js";
import type { ParsedToolCall } from "../../src/types.js";

describe("default tool registry integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-registry-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers all default tools in order", () => {
    const registry = createDefaultToolRegistry(tempDir);

    expect(registry.getAll().map((tool) => tool.name)).toEqual([
      "read_file",
      "write_file",
      "edit_file",
      "run_command",
      "grep",
      "glob",
      "todo_write",
    ]);
    expect(
      registry.getAll().map((tool) => [tool.name, tool.category])
    ).toEqual([
      ["read_file", "read"],
      ["write_file", "write"],
      ["edit_file", "write"],
      ["run_command", "command"],
      ["grep", "read"],
      ["glob", "read"],
      ["todo_write", "read"],
    ]);
  });

  it("exports OpenAI-compatible definitions for all default tools", () => {
    const registry = createDefaultToolRegistry(tempDir);

    expect(
      registry.getToolDefinitions().map((tool) => tool.function.name)
    ).toEqual([
      "read_file",
      "write_file",
      "edit_file",
      "run_command",
      "grep",
      "glob",
      "todo_write",
    ]);
    for (const definition of registry.getToolDefinitions()) {
      expect(definition.type).toBe("function");
      expect(definition.function.description).not.toBe("");
      expect(definition.function.parameters).toHaveProperty("type", "object");
      expect(definition).not.toHaveProperty("execute");
      expect(definition).not.toHaveProperty("category");
    }
  });

  it("executes simulated multi-tool calls through the registry", async () => {
    const registry = createDefaultToolRegistry(tempDir);
    const calls: ParsedToolCall[] = [
      {
        id: "call-write",
        name: "write_file",
        input: { path: "notes/hello.txt", content: "hello" },
      },
      {
        id: "call-read",
        name: "read_file",
        input: { path: "notes/hello.txt" },
      },
      {
        id: "call-edit",
        name: "edit_file",
        input: {
          path: "notes/hello.txt",
          old_string: "hello",
          new_string: "hello edited",
        },
      },
      {
        id: "call-read-edited",
        name: "read_file",
        input: { path: "notes/hello.txt" },
      },
      {
        id: "call-run",
        name: "run_command",
        input: { command: "node -e \"console.log('ok')\"" },
      },
      {
        id: "call-grep",
        name: "grep",
        input: { pattern: "edited", include: "**/*.txt" },
      },
      {
        id: "call-glob",
        name: "glob",
        input: { pattern: "**/*.txt" },
      },
      {
        id: "call-todo",
        name: "todo_write",
        input: {
          todos: [
            { id: "inspect", content: "Inspect files", status: "completed" },
            { id: "finish", content: "Finish task", status: "in_progress" },
          ],
        },
      },
    ];

    const results = [];
    for (const call of calls) {
      results.push(await registry.execute(call.name, call.input));
    }

    expect(results[0]).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 5 characters to notes/hello.txt",
    });
    expect(results[1]).toEqual({
      tool_call_id: "read_file",
      output: "hello",
    });
    expect(results[2]).toEqual({
      tool_call_id: "edit_file",
      output: "Edited notes/hello.txt: replaced 1 occurrence",
    });
    expect(results[3]).toEqual({
      tool_call_id: "read_file",
      output: "hello edited",
    });
    expect(results[4].tool_call_id).toBe("run_command");
    expect(results[4].error).toBeUndefined();
    expect(results[4].output).toMatch(/ok/);
    expect(results[5]).toEqual({
      tool_call_id: "grep",
      output: "notes/hello.txt:1: hello edited",
    });
    expect(results[6]).toEqual({
      tool_call_id: "glob",
      output: "notes/hello.txt",
    });
    expect(results[7]).toEqual({
      tool_call_id: "todo_write",
      output: [
        "Progress: 1/2 completed",
        "[x] Inspect files",
        "[~] Finish task",
      ].join("\n"),
    });
  });

  it("throws when a simulated tool call names an unknown tool", async () => {
    const registry = createDefaultToolRegistry(tempDir);

    await expect(registry.execute("missing_tool", {})).rejects.toThrow(
      /Tool not found: missing_tool/
    );
  });
});
