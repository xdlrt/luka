import { describe, expect, it, vi } from "vitest";
import { ToolRegistry, type ToolDefinition } from "../../src/tools/index.js";

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
    execute: vi.fn(async (input: Record<string, unknown>) => ({
      tool_call_id: `${name}-call`,
      output: String(input.message ?? ""),
    })),
  };
}

describe("ToolRegistry", () => {
  it("registers and gets a tool by name", () => {
    const registry = new ToolRegistry();
    const tool = createTool("echo");

    registry.register(tool);

    expect(registry.get("echo")).toBe(tool);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists tools in registration order", () => {
    const registry = new ToolRegistry();
    const first = createTool("first");
    const second = createTool("second");

    registry.register(first);
    registry.register(second);

    expect(registry.getAll()).toEqual([first, second]);
  });

  it("throws when registering the same name twice", () => {
    const registry = new ToolRegistry();
    registry.register(createTool("echo"));

    expect(() => registry.register(createTool("echo"))).toThrow(
      /Tool already registered: echo/
    );
  });

  it("executes a registered tool and returns its result", async () => {
    const registry = new ToolRegistry();
    const tool = createTool("echo");
    registry.register(tool);

    const result = await registry.execute("echo", { message: "hello" });

    expect(tool.execute).toHaveBeenCalledWith({ message: "hello" });
    expect(result).toEqual({ tool_call_id: "echo-call", output: "hello" });
  });

  it("throws when executing an unknown tool", async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute("missing", {})).rejects.toThrow(
      /Tool not found: missing/
    );
  });

  it("exports OpenAI-compatible tool definitions without runtime fields", () => {
    const registry = new ToolRegistry();
    const tool = { ...createTool("echo"), category: "read" as const };
    registry.register(tool);

    expect(registry.getToolDefinitions()).toEqual([
      {
        type: "function",
        function: {
          name: "echo",
          description: "echo description",
          parameters: tool.parameters,
        },
      },
    ]);
    expect(registry.getToolDefinitions()[0]).not.toHaveProperty("execute");
    expect(registry.getToolDefinitions()[0]).not.toHaveProperty("category");
  });
});
