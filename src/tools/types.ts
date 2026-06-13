import type { ToolResult } from "../types.js";
import type { RegisteredToolCategory } from "../permissions/categories.js";

export type { RegisteredToolCategory as ToolCategory } from "../permissions/categories.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
  category?: RegisteredToolCategory;
}
