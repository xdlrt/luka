import { parseTodoItems, type TodoManager } from "../planning/todo.js";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "todo_write";

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

export function createTodoWriteTool(todoManager: TodoManager): ToolDefinition {
  return {
    name: "todo_write",
    description:
      "Replace the current in-memory TODO plan with a complete structured list",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description:
            "Complete TODO list replacing the current plan. At most one item may be in_progress.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Stable TODO item id",
              },
              content: {
                type: "string",
                description: "Concrete task description",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current item status",
              },
            },
            required: ["id", "content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    async execute(input: Record<string, unknown>) {
      try {
        const todos = parseTodoItems(input.todos);
        todoManager.update(todos);
        const output = todoManager.formatForDisplay();
        return {
          tool_call_id: TOOL_CALL_ID,
          output: output === "" ? "TODO list cleared" : output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }
    },
  };
}
