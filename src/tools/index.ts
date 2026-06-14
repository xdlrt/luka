import type { ToolDefinition as ChatToolDefinition, ToolResult } from "../types.js";
import { createEditFileTool } from "./edit-file.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadFileTool } from "./read-file.js";
import { createRunCommandTool } from "./run-command.js";
import type { ToolDefinition } from "./types.js";
import { TodoManager } from "../planning/todo.js";
import { createTodoWriteTool } from "./todo-write.js";
import { createWriteFileTool } from "./write-file.js";

export type { ToolCategory, ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly todoManager?: TodoManager) {}

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(input);
  }

  getToolDefinitions(): ChatToolDefinition[] {
    return this.getAll().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  getTodoManager(): TodoManager | undefined {
    return this.todoManager;
  }
}

export function createDefaultToolRegistry(
  workingDirectory: string,
  todoManager: TodoManager = new TodoManager()
): ToolRegistry {
  const registry = new ToolRegistry(todoManager);
  registry.register(createReadFileTool(workingDirectory));
  registry.register(createWriteFileTool(workingDirectory));
  registry.register(createEditFileTool(workingDirectory));
  registry.register(createRunCommandTool(workingDirectory));
  registry.register(createGrepTool(workingDirectory));
  registry.register(createGlobTool(workingDirectory));
  registry.register(createTodoWriteTool(todoManager));
  return registry;
}
