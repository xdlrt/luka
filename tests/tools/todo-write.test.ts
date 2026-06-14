import { describe, expect, it } from "vitest";
import { TodoManager } from "../../src/planning/todo.js";
import { createTodoWriteTool } from "../../src/tools/todo-write.js";

describe("todo_write tool", () => {
  it("replaces the current todo list and returns formatted progress", async () => {
    const manager = new TodoManager();
    const tool = createTodoWriteTool(manager);

    const result = await tool.execute({
      todos: [
        { id: "inspect", content: "Inspect code", status: "completed" },
        { id: "implement", content: "Implement tool", status: "in_progress" },
        { id: "test", content: "Run tests", status: "pending" },
      ],
    });

    expect(result).toEqual({
      tool_call_id: "todo_write",
      output: [
        "Progress: 1/3 completed",
        "[x] Inspect code",
        "[~] Implement tool",
        "[ ] Run tests",
      ].join("\n"),
    });
    expect(manager.getAll()).toEqual([
      { id: "inspect", content: "Inspect code", status: "completed" },
      { id: "implement", content: "Implement tool", status: "in_progress" },
      { id: "test", content: "Run tests", status: "pending" },
    ]);
  });

  it("can clear the current todo list", async () => {
    const manager = new TodoManager();
    manager.update([{ id: "a", content: "First", status: "pending" }]);
    const tool = createTodoWriteTool(manager);

    const result = await tool.execute({ todos: [] });

    expect(result).toEqual({
      tool_call_id: "todo_write",
      output: "TODO list cleared",
    });
    expect(manager.getAll()).toEqual([]);
  });

  it("reports invalid inputs as tool errors", async () => {
    const tool = createTodoWriteTool(new TodoManager());

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "todo_write",
      output: "",
      error: expect.stringMatching(/todos to be an array/),
    });
    await expect(tool.execute({ todos: {} })).resolves.toMatchObject({
      tool_call_id: "todo_write",
      output: "",
      error: expect.stringMatching(/todos to be an array/),
    });
    await expect(
      tool.execute({ todos: [{ id: "a", content: "First", status: "bad" }] })
    ).resolves.toMatchObject({
      tool_call_id: "todo_write",
      output: "",
      error: expect.stringMatching(/status must be pending/),
    });
    await expect(
      tool.execute({
        todos: [
          { id: "a", content: "First", status: "in_progress" },
          { id: "b", content: "Second", status: "in_progress" },
        ],
      })
    ).resolves.toMatchObject({
      tool_call_id: "todo_write",
      output: "",
      error: expect.stringMatching(/at most one in_progress/),
    });
  });
});
