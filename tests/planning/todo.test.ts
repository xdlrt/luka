import { describe, expect, it } from "vitest";
import { parseTodoItems, TodoManager } from "../../src/planning/todo.js";

describe("TodoManager", () => {
  it("creates and updates a todo list", () => {
    const manager = new TodoManager();

    manager.update([
      { id: "inspect", content: "Inspect code", status: "completed" },
      { id: "implement", content: "Implement tool", status: "in_progress" },
      { id: "test", content: "Run tests", status: "pending" },
    ]);

    expect(manager.getAll()).toEqual([
      { id: "inspect", content: "Inspect code", status: "completed" },
      { id: "implement", content: "Implement tool", status: "in_progress" },
      { id: "test", content: "Run tests", status: "pending" },
    ]);
    expect(manager.formatForDisplay()).toBe(
      [
        "Progress: 1/3 completed",
        "[x] Inspect code",
        "[~] Implement tool",
        "[ ] Run tests",
      ].join("\n")
    );
  });

  it("replaces the current state with the full list", () => {
    const manager = new TodoManager();

    manager.update([
      { id: "a", content: "First", status: "pending" },
      { id: "b", content: "Second", status: "pending" },
    ]);
    manager.update([{ id: "c", content: "Replacement", status: "completed" }]);

    expect(manager.getAll()).toEqual([
      { id: "c", content: "Replacement", status: "completed" },
    ]);
  });

  it("returns defensive copies", () => {
    const manager = new TodoManager();
    manager.update([{ id: "a", content: "First", status: "pending" }]);

    const todos = manager.getAll();
    todos[0] = { id: "changed", content: "Changed", status: "completed" };

    expect(manager.getAll()).toEqual([
      { id: "a", content: "First", status: "pending" },
    ]);
  });

  it("formats empty state as an empty string", () => {
    const manager = new TodoManager();

    expect(manager.formatForDisplay()).toBe("");
    expect(manager.formatForModel()).toBe("");
  });

  it("formats todo state for the model", () => {
    const manager = new TodoManager();
    manager.update([{ id: "a", content: "First", status: "in_progress" }]);

    expect(manager.formatForModel()).toBe(
      ["Current TODO state:", "Progress: 0/1 completed", "[~] First"].join("\n")
    );
  });

  it("rejects invalid todo item fields", () => {
    const manager = new TodoManager();

    expect(() =>
      manager.update([{ id: "", content: "First", status: "pending" }])
    ).toThrow(/non-empty string id/);
    expect(() =>
      manager.update([{ id: "a", content: "", status: "pending" }])
    ).toThrow(/non-empty string content/);
    expect(() =>
      manager.update([{ id: "a", content: "First", status: "blocked" }])
    ).toThrow(/status must be pending, in_progress, or completed/);
  });

  it("rejects multiple in_progress items", () => {
    const manager = new TodoManager();

    expect(() =>
      manager.update([
        { id: "a", content: "First", status: "in_progress" },
        { id: "b", content: "Second", status: "in_progress" },
      ])
    ).toThrow(/at most one in_progress/);
  });
});

describe("parseTodoItems", () => {
  it("parses valid todo items", () => {
    expect(
      parseTodoItems([{ id: "a", content: "First", status: "pending" }])
    ).toEqual([{ id: "a", content: "First", status: "pending" }]);
  });

  it("rejects non-array input", () => {
    expect(() => parseTodoItems({})).toThrow(/todos to be an array/);
  });

  it("rejects non-object items", () => {
    expect(() => parseTodoItems(["bad"])).toThrow(/must be an object/);
  });
});
