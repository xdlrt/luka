import type { ToolDefinition } from "../types.js";

export const echoTool: ToolDefinition = {
  type: "function",
  function: {
    name: "echo",
    description: "回显传入的 message",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "要回显的文本",
        },
      },
      required: ["message"],
    },
  },
};
