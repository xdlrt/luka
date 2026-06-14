import type { AppConfig } from "./config.js";
import { ContextCompressor } from "./context/compressor.js";
import type {
  ContextCompressorClient,
  HistoryCompressor,
} from "./context/compressor.js";
import { MessageHistory } from "./context/message-history.js";
import { SYSTEM_PROMPT } from "./context/system-prompt.js";
import { Harness, type HarnessLike } from "./harness.js";
import { createLogger, type Logger } from "./logger.js";
import { LLMClient, parseResponse } from "./llm-client.js";
import type { ToolRegistry } from "./tools/index.js";

export interface AgentResult {
  finalMessage: string;
  turnsUsed: number;
  toolsCalled: string[];
  success: boolean;
  totalTokens: number;
}

export async function runAgentLoop(
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  client: LLMClient = new LLMClient(config),
  harness: HarnessLike | undefined = undefined,
  logger: Logger = createLogger({ verbose: config.verbose }),
  compressor: HistoryCompressor = new ContextCompressor(
    client as ContextCompressorClient
  )
): Promise<AgentResult> {
  const activeHarness =
    harness ?? Harness.fromAppConfig(config, { logger });
  const history = new MessageHistory([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ]);
  const toolsCalled: string[] = [];
  const toolDefinitions = tools.getToolDefinitions();

  let lastText = "";
  let lastModelAction = "";
  let totalTokens = 0;

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    logger.info(`[TURN ${turn}] started`);
    activeHarness.beginTurn();
    const turnStartedAt = Date.now();
    if (await compressor.shouldCompress(history)) {
      const beforeTokens = history.getApproxTokenCount();
      const compressedHistory = await compressor.compress(history);
      const afterTokens = compressedHistory.getApproxTokenCount();
      history.replace(compressedHistory.getMessages());
      logger.info(
        `[CONTEXT] Compressing: ${beforeTokens} → ${afterTokens} tokens`
      );
    }
    const messages = history.getMessages();
    logger.debug(
      `[CONTEXT] messages=${messages.length}, approxTokens=${history.getApproxTokenCount()}`
    );
    const response = await client.sendMessage(messages, {
      tools: toolDefinitions,
    });
    totalTokens += response.usage.total_tokens;
    logger.debug(
      `[TURN ${turn}] LLM response received in ${Date.now() - turnStartedAt}ms`
    );
    const assistantMessage = response.choices[0]?.message;
    if (assistantMessage !== undefined) {
      history.append(assistantMessage);
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
        totalTokens,
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
      history.append({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
      if (result.verificationMessage !== undefined) {
        history.append({
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
    totalTokens,
  };
}

function summarizeModelAction(toolNames: string[], text: string): string {
  if (toolNames.length > 0) return `tools: ${toolNames.join(", ")}`;
  return text.slice(0, 120);
}
