import type { AppConfig } from "./config.js";
import { SYSTEM_PROMPT } from "./context/system-prompt.js";
import { Harness, type HarnessLike } from "./harness.js";
import { createLogger, type Logger } from "./logger.js";
import { LLMClient, parseResponse } from "./llm-client.js";
import type { ToolRegistry } from "./tools/index.js";
import type { Message } from "./types.js";

export interface AgentResult {
  finalMessage: string;
  turnsUsed: number;
  toolsCalled: string[];
  success: boolean;
}

export async function runAgentLoop(
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  client: LLMClient = new LLMClient(config),
  harness: HarnessLike | undefined = undefined,
  logger: Logger = createLogger({ verbose: config.verbose })
): Promise<AgentResult> {
  const activeHarness =
    harness ?? Harness.fromAppConfig(config, { logger });
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];
  const toolsCalled: string[] = [];
  const toolDefinitions = tools.getToolDefinitions();

  let lastText = "";
  let lastModelAction = "";

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    logger.info(`[TURN ${turn}] started`);
    activeHarness.beginTurn();
    const turnStartedAt = Date.now();
    const response = await client.sendMessage(messages, {
      tools: toolDefinitions,
    });
    logger.debug(
      `[TURN ${turn}] LLM response received in ${Date.now() - turnStartedAt}ms`
    );
    const assistantMessage = response.choices[0]?.message;
    if (assistantMessage !== undefined) {
      messages.push(assistantMessage);
    }

    const parsed = parseResponse(response);
    lastText = parsed.text ?? "";
    lastModelAction = summarizeModelAction(
      parsed.toolCalls.map((call) => call.name),
      lastText
    );
    logger.debug(`[TURN ${turn}] tool calls=${parsed.toolCalls.length}`);

    if (parsed.toolCalls.length === 0) {
      logger.info(`[TURN ${turn}] no tool calls; finishing`);
      return {
        finalMessage: lastText,
        turnsUsed: turn,
        toolsCalled,
        success: true,
      };
    }

    for (const call of parsed.toolCalls) {
      toolsCalled.push(call.name);
      const result = await activeHarness.executeTool(
        call.name,
        call.input,
        tools,
        lastModelAction
      );
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
      if (result.verificationMessage !== undefined) {
        messages.push({
          role: "assistant",
          content: result.verificationMessage,
        });
      }
    }
    activeHarness.endTurn();
  }

  logger.warn(`[Agent] Reached maxTurns=${config.maxTurns}; stopping`);
  return {
    finalMessage: lastText,
    turnsUsed: config.maxTurns,
    toolsCalled,
    success: false,
  };
}

function summarizeModelAction(toolNames: string[], text: string): string {
  if (toolNames.length > 0) return `tools: ${toolNames.join(", ")}`;
  return text.slice(0, 120);
}
