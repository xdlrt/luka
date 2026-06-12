import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadFileTool } from "../../src/tools/read-file.js";

describe("createReadFileTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-read-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the read_file tool schema", () => {
    const tool = createReadFileTool(tempDir);

    expect(tool.name).toBe("read_file");
    expect(tool.category).toBe("read");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to read",
        },
      },
      required: ["path"],
    });
  });

  it("reads an existing UTF-8 text file", async () => {
    await writeFile(path.join(tempDir, "hello.txt"), "hello\nworld", "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "hello.txt" });

    expect(result).toEqual({
      tool_call_id: "read_file",
      output: "hello\nworld",
    });
  });

  it("reads an empty file", async () => {
    await writeFile(path.join(tempDir, "empty.txt"), "", "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "empty.txt" });

    expect(result).toEqual({ tool_call_id: "read_file", output: "" });
  });

  it("returns an error when the file does not exist", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "missing.txt" });

    expect(result.tool_call_id).toBe("read_file");
    expect(result.output).toBe("");
    expect(result.error).toMatch(/Failed to read file "missing.txt"/);
  });

  it("returns an error when path is missing or invalid", async () => {
    const tool = createReadFileTool(tempDir);

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(tool.execute({ path: 123 })).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(tool.execute({ path: "   " })).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
  });

  it("rejects absolute paths", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: path.join(tempDir, "hello.txt") });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/must be relative/),
    });
  });

  it("rejects paths containing parent traversal", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "../secret.txt" });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
  });

  it("returns an error for binary files", async () => {
    await writeFile(path.join(tempDir, "binary.bin"), Buffer.from([0, 1, 2]));
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "binary.bin" });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/cannot read binary file/),
    });
  });
});
