import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGlobTool } from "../../src/tools/glob.js";

describe("createGlobTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-glob-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the glob tool schema", () => {
    const tool = createGlobTool(tempDir);

    expect(tool.name).toBe("glob");
    expect(tool.category).toBe("read");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern for files to find, such as **/*.ts",
        },
        path: {
          type: "string",
          description: "Relative directory to search from; defaults to .",
        },
      },
      required: ["pattern"],
    });
  });

  it("finds TypeScript files with a recursive pattern", async () => {
    await writeFile(path.join(tempDir, "index.ts"), "", "utf8");
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src/app.ts"), "", "utf8");
    await writeFile(path.join(tempDir, "src/app.js"), "", "utf8");
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({ pattern: "**/*.ts" });

    expect(result).toEqual({
      tool_call_id: "glob",
      output: "index.ts\nsrc/app.ts",
    });
  });

  it("supports nested patterns from a relative search path", async () => {
    await mkdir(path.join(tempDir, "project/src/features"), { recursive: true });
    await writeFile(
      path.join(tempDir, "project/src/features/user.test.ts"),
      "",
      "utf8"
    );
    await writeFile(path.join(tempDir, "project/src/user.ts"), "", "utf8");
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({
      pattern: "src/**/*.test.ts",
      path: "project",
    });

    expect(result).toEqual({
      tool_call_id: "glob",
      output: "project/src/features/user.test.ts",
    });
  });

  it("matches files at the search root", async () => {
    await writeFile(path.join(tempDir, "package.json"), "{}", "utf8");
    await mkdir(path.join(tempDir, "nested"), { recursive: true });
    await writeFile(path.join(tempDir, "nested/package.json"), "{}", "utf8");
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({ pattern: "*.json" });

    expect(result).toEqual({
      tool_call_id: "glob",
      output: "package.json",
    });
  });

  it("returns a no files message when nothing matches", async () => {
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({ pattern: "**/*.ts" });

    expect(result).toEqual({ tool_call_id: "glob", output: "No files found" });
  });

  it("limits output to the first 100 sorted files", async () => {
    for (let index = 0; index < 105; index += 1) {
      const name = `file-${String(index).padStart(3, "0")}.ts`;
      await writeFile(path.join(tempDir, name), "", "utf8");
    }
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({ pattern: "**/*.ts" });

    const lines = result.output.split("\n");
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe("file-000.ts");
    expect(lines[99]).toBe("file-099.ts");
    expect(lines[100]).toBe("truncated: showing first 100 files");
  });

  it("ignores node_modules, .git, and dist by default", async () => {
    await mkdir(path.join(tempDir, "node_modules/pkg"), { recursive: true });
    await mkdir(path.join(tempDir, ".git/hooks"), { recursive: true });
    await mkdir(path.join(tempDir, "dist"), { recursive: true });
    await writeFile(path.join(tempDir, "src.ts"), "", "utf8");
    await writeFile(path.join(tempDir, "node_modules/pkg/index.ts"), "", "utf8");
    await writeFile(path.join(tempDir, ".git/hooks/pre-commit.ts"), "", "utf8");
    await writeFile(path.join(tempDir, "dist/bundle.ts"), "", "utf8");
    const tool = createGlobTool(tempDir);

    const result = await tool.execute({ pattern: "**/*.ts" });

    expect(result).toEqual({ tool_call_id: "glob", output: "src.ts" });
  });

  it("returns an error when path or pattern is invalid", async () => {
    const tool = createGlobTool(tempDir);

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "glob",
      output: "",
      error: expect.stringMatching(/non-empty string pattern/),
    });
    await expect(
      tool.execute({ pattern: "**/*.ts", path: "../outside" })
    ).resolves.toMatchObject({
      tool_call_id: "glob",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
    await expect(
      tool.execute({ pattern: "../*.ts" })
    ).resolves.toMatchObject({
      tool_call_id: "glob",
      output: "",
      error: expect.stringMatching(/pattern must not contain \.\./),
    });
  });
});
