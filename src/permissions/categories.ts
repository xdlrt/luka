export type RegisteredToolCategory = "read" | "write" | "command";
export type ToolCategory = RegisteredToolCategory | "unknown";

const TOOL_CATEGORIES: Record<string, RegisteredToolCategory> = {
  read_file: "read",
  write_file: "write",
  edit_file: "write",
  run_command: "command",
  grep: "read",
  glob: "read",
};

export function classifyTool(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? "unknown";
}
