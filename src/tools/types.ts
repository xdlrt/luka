import type { ToolResult } from "../types.js";

export type ToolCategory = "read" | "write" | "command";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
  category?: ToolCategory;
}
