import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "read_file";

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("read_file requires a non-empty string path");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("read_file path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("read_file path must not contain ..");
  }
  return inputPath;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export function createReadFileTool(workingDirectory: string): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file from the working directory",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to read",
        },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      try {
        inputPath = validatePath(input.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const fullPath = path.resolve(workingDirectory, inputPath);
      try {
        const buffer = await readFile(fullPath);
        if (isBinary(buffer)) {
          return errorResult(`read_file cannot read binary file: ${inputPath}`);
        }
        return {
          tool_call_id: TOOL_CALL_ID,
          output: buffer.toString("utf8"),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to read file "${inputPath}": ${message}`);
      }
    },
  };
}
