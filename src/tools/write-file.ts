import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "write_file";

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("write_file requires a non-empty string path");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("write_file path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("write_file path must not contain ..");
  }
  return inputPath;
}

function validateContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new Error("write_file requires string content");
  }
  return content;
}

export function createWriteFileTool(workingDirectory: string): ToolDefinition {
  return {
    name: "write_file",
    description: "Write UTF-8 text content to a file in the working directory",
    category: "write",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to write",
        },
        content: {
          type: "string",
          description: "UTF-8 text content to write",
        },
      },
      required: ["path", "content"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      let content: string;
      try {
        inputPath = validatePath(input.path);
        content = validateContent(input.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const fullPath = path.resolve(workingDirectory, inputPath);
      try {
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, "utf8");
        return {
          tool_call_id: TOOL_CALL_ID,
          output: `Wrote ${content.length} characters to ${inputPath}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to write file "${inputPath}": ${message}`);
      }
    },
  };
}
