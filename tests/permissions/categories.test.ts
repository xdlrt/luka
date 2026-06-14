import { describe, expect, it } from "vitest";
import { classifyTool } from "../../src/permissions/categories.js";
import { createDefaultToolRegistry } from "../../src/tools/index.js";

describe("classifyTool", () => {
  it("classifies known tool names", () => {
    expect(classifyTool("read_file")).toBe("read");
    expect(classifyTool("write_file")).toBe("write");
    expect(classifyTool("edit_file")).toBe("write");
    expect(classifyTool("run_command")).toBe("command");
    expect(classifyTool("grep")).toBe("read");
    expect(classifyTool("glob")).toBe("read");
  });

  it("returns unknown for unregistered tool names", () => {
    expect(classifyTool("missing_tool")).toBe("unknown");
  });

  it("matches every default registered tool category", () => {
    const registry = createDefaultToolRegistry(process.cwd());

    for (const tool of registry.getAll()) {
      expect(tool.category).toBeDefined();
      expect(tool.category).not.toBe("unknown");
      expect(tool.category).toBe(classifyTool(tool.name));
    }
  });
});
