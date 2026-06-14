import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditFileTool } from "../../src/tools/edit-file.js";

describe("createEditFileTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-edit-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the edit_file tool schema", () => {
    const tool = createEditFileTool(tempDir);

    expect(tool.name).toBe("edit_file");
    expect(tool.category).toBe("write");
    expect(tool.parameters).toEqual({
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
    });
  });

  it("replaces one exact old_string match", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "hello old world", "utf8");
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "note.txt",
      old_string: "old",
      new_string: "new",
    });

    await expect(readFile(path.join(tempDir, "note.txt"), "utf8")).resolves.toBe(
      "hello new world"
    );
    expect(result).toEqual({
      tool_call_id: "edit_file",
      output: "Edited note.txt: replaced 1 occurrence",
    });
  });

  it("allows an empty new_string to delete text", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "hello removable world", "utf8");
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "note.txt",
      old_string: "removable ",
      new_string: "",
    });

    await expect(readFile(path.join(tempDir, "note.txt"), "utf8")).resolves.toBe(
      "hello world"
    );
    expect(result).toEqual({
      tool_call_id: "edit_file",
      output: "Edited note.txt: replaced 1 occurrence",
    });
  });

  it("returns an error for an empty file without modifying it", async () => {
    await writeFile(path.join(tempDir, "empty.txt"), "", "utf8");
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "empty.txt",
      old_string: "missing",
      new_string: "replacement",
    });

    await expect(readFile(path.join(tempDir, "empty.txt"), "utf8")).resolves.toBe(
      ""
    );
    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/could not find old_string/),
    });
  });

  it("returns an error when old_string is not found without modifying the file", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "keep me", "utf8");
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "note.txt",
      old_string: "missing",
      new_string: "replacement",
    });

    await expect(readFile(path.join(tempDir, "note.txt"), "utf8")).resolves.toBe(
      "keep me"
    );
    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/could not find old_string/),
    });
  });

  it("returns an error when old_string matches multiple times without modifying the file", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "same and same", "utf8");
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "note.txt",
      old_string: "same",
      new_string: "different",
    });

    await expect(readFile(path.join(tempDir, "note.txt"), "utf8")).resolves.toBe(
      "same and same"
    );
    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/found old_string 2 times/),
    });
  });

  it("returns an error when path is missing or invalid", async () => {
    const tool = createEditFileTool(tempDir);

    await expect(
      tool.execute({ old_string: "a", new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(
      tool.execute({ path: 123, old_string: "a", new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(
      tool.execute({ path: "   ", old_string: "a", new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
  });

  it("returns an error when old_string is missing or invalid", async () => {
    const tool = createEditFileTool(tempDir);

    await expect(
      tool.execute({ path: "note.txt", new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string old_string/),
    });
    await expect(
      tool.execute({ path: "note.txt", old_string: 123, new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string old_string/),
    });
    await expect(
      tool.execute({ path: "note.txt", old_string: "   ", new_string: "b" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/non-empty string old_string/),
    });
  });

  it("returns an error when new_string is missing or invalid", async () => {
    const tool = createEditFileTool(tempDir);

    await expect(
      tool.execute({ path: "note.txt", old_string: "a" })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/requires string new_string/),
    });
    await expect(
      tool.execute({ path: "note.txt", old_string: "a", new_string: 123 })
    ).resolves.toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/requires string new_string/),
    });
  });

  it("rejects absolute paths", async () => {
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: path.join(tempDir, "file.txt"),
      old_string: "a",
      new_string: "b",
    });

    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/must be relative/),
    });
  });

  it("rejects paths containing parent traversal", async () => {
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "../file.txt",
      old_string: "a",
      new_string: "b",
    });

    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
  });

  it("returns an error for binary files without modifying them", async () => {
    await writeFile(path.join(tempDir, "binary.bin"), Buffer.from([0, 1, 2]));
    const tool = createEditFileTool(tempDir);

    const result = await tool.execute({
      path: "binary.bin",
      old_string: "\u0000",
      new_string: "x",
    });

    await expect(readFile(path.join(tempDir, "binary.bin"))).resolves.toEqual(
      Buffer.from([0, 1, 2])
    );
    expect(result).toMatchObject({
      tool_call_id: "edit_file",
      output: "",
      error: expect.stringMatching(/cannot edit binary file/),
    });
  });
});
