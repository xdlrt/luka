import type { AppConfig } from "./config.js";
import { SYSTEM_PROMPT } from "./context/system-prompt.js";
import { LLMClient, parseResponse } from "./llm-client.js";
import {
  checkToolPermission,
  type PermissionDecision,
} from "./permissions/index.js";
import { checkCommandSafety } from "./permissions/rules.js";
import { checkPathInSandbox } from "./permissions/sandbox.js";
import type { ToolRegistry } from "./tools/index.js";
import type { ToolDefinition } from "./tools/types.js";
import type { Message } from "./types.js";

export interface AgentResult {
  finalMessage: string;
  turnsUsed: number;
  toolsCalled: string[];
  success: boolean;
}

export type PermissionChecker = (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  options: { autoApprove?: boolean }
) => Promise<PermissionDecision>;

export type SafetyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export type SafetyChecker = (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  options: { workingDirectory: string }
) => Promise<SafetyDecision>;

export async function checkToolSafety(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  options: { workingDirectory: string }
): Promise<SafetyDecision> {
  if (tool.name === "read_file" || tool.name === "write_file" || tool.name === "edit_file") {
    const sandbox = checkPathInSandbox(options.workingDirectory, input.path);
    if (!sandbox.allowed) {
      return { allowed: false, reason: sandbox.reason };
    }
  }

  if (tool.name === "run_command") {
    const commandSafety = checkCommandSafety(input.command);
    if (!commandSafety.allowed) {
      return { allowed: false, reason: commandSafety.reason };
    }
  }

  return { allowed: true };
}

export async function runAgentLoop(
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  client: LLMClient = new LLMClient(config),
  permissionCheck: PermissionChecker = checkToolPermission,
  safetyCheck: SafetyChecker = checkToolSafety
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];
  const toolsCalled: string[] = [];
  const toolDefinitions = tools.getToolDefinitions();

  let lastText = "";

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    console.log(`[Agent] Turn ${turn}/${config.maxTurns}`);
    const response = await client.sendMessage(messages, {
      tools: toolDefinitions,
    });
    const assistantMessage = response.choices[0]?.message;
    if (assistantMessage !== undefined) {
      messages.push(assistantMessage);
    }

    const parsed = parseResponse(response);
    lastText = parsed.text ?? "";

    if (parsed.toolCalls.length === 0) {
      console.log(`[Agent] No tool calls; finishing at turn ${turn}`);
      return {
        finalMessage: lastText,
        turnsUsed: turn,
        toolsCalled,
        success: true,
      };
    }

    for (const call of parsed.toolCalls) {
      toolsCalled.push(call.name);
      let content: string;
      try {
        const tool = tools.get(call.name);
        if (tool === undefined) {
          throw new Error(`Tool not found: ${call.name}`);
        }

        const safety = await safetyCheck(tool, call.input, {
          workingDirectory: config.workingDirectory,
        });
        if (!safety.allowed) {
          content = `[blocked] ${safety.reason}`;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content,
          });
          continue;
        }

        const permission = await permissionCheck(tool, call.input, {
          autoApprove: config.autoApprove,
        });
        if (!permission.approved) {
          content = `[permission denied] ${permission.reason}`;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content,
          });
          continue;
        }

        const result = await tools.execute(call.name, call.input);
        content = result.error
          ? `${result.output}\n[error] ${result.error}`
          : result.output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        content = `[error] ${message}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      });
    }
  }

  console.log(`[Agent] Reached maxTurns=${config.maxTurns}; stopping`);
  return {
    finalMessage: lastText,
    turnsUsed: config.maxTurns,
    toolsCalled,
    success: false,
  };
}
