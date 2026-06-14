import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "edit_file";

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("edit_file requires a non-empty string path");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("edit_file path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("edit_file path must not contain ..");
  }
  return inputPath;
}

function validateOldString(oldString: unknown): string {
  if (typeof oldString !== "string" || oldString.trim() === "") {
    throw new Error("edit_file requires a non-empty string old_string");
  }
  return oldString;
}

function validateNewString(newString: unknown): string {
  if (typeof newString !== "string") {
    throw new Error("edit_file requires string new_string");
  }
  return newString;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function countOccurrences(content: string, search: string): number {
  let count = 0;
  let index = content.indexOf(search);

  while (index !== -1) {
    count += 1;
    index = content.indexOf(search, index + search.length);
  }

  return count;
}

export function createEditFileTool(workingDirectory: string): ToolDefinition {
  return {
    name: "edit_file",
    description:
      "Edit a UTF-8 text file by replacing one exact old_string match with new_string",
    category: "write",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "Existing text to replace; must match exactly once",
        },
        new_string: {
          type: "string",
          description: "Replacement text",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      let oldString: string;
      let newString: string;
      try {
        inputPath = validatePath(input.path);
        oldString = validateOldString(input.old_string);
        newString = validateNewString(input.new_string);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const fullPath = path.resolve(workingDirectory, inputPath);
      try {
        const buffer = await readFile(fullPath);
        if (isBinary(buffer)) {
          return errorResult(`edit_file cannot edit binary file: ${inputPath}`);
        }

        const content = buffer.toString("utf8");
        const occurrences = countOccurrences(content, oldString);
        if (occurrences === 0) {
          return errorResult(
            `edit_file could not find old_string in "${inputPath}"`
          );
        }
        if (occurrences > 1) {
          return errorResult(
            `edit_file found old_string ${occurrences} times in "${inputPath}"; provide more context`
          );
        }

        const updatedContent = content.replace(oldString, newString);
        await writeFile(fullPath, updatedContent, "utf8");
        return {
          tool_call_id: TOOL_CALL_ID,
          output: `Edited ${inputPath}: replaced 1 occurrence`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to edit file "${inputPath}": ${message}`);
      }
    },
  };
}
