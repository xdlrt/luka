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
import type { EventRecorderLike } from "./observability/recorder.js";
import type { TodoManager } from "./planning/todo.js";
import type { ToolRegistry } from "./tools/index.js";
import type { Message } from "./types.js";
import type {
  CompactBoundary,
  SessionCheckpoint,
  ToolSummary,
  VerificationSummary,
} from "./session-store.js";

export interface AgentResult {
  finalMessage: string;
  turnsUsed: number;
  toolsCalled: string[];
  success: boolean;
  totalTokens: number;
  todoDisplay?: string;
}

export interface AgentLoopOptions {
  initialMessages?: Message[];
  checkpoint?: (checkpoint: SessionCheckpoint) => Promise<void>;
  checkpointWarning?: (message: string) => void;
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
  ),
  recorder?: EventRecorderLike,
  options: AgentLoopOptions = {}
): Promise<AgentResult> {
  const activeHarness =
    harness ?? Harness.fromAppConfig(config, { logger, recorder });
  const todoManager = tools.getTodoManager();
  const history = new MessageHistory(
    createInitialMessages(userInput, options.initialMessages)
  );
  const toolsCalled: string[] = [];
  const toolDefinitions = tools.getToolDefinitions();
  const toolSummaries: ToolSummary[] = [];
  const verificationSummaries: VerificationSummary[] = [];
  const compactBoundaries: CompactBoundary[] = [];

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
      compactBoundaries.push({
        turn,
        beforeTokens,
        afterTokens,
        createdAt: new Date().toISOString(),
      });
      logger.info(
        `[CONTEXT] Compressing: ${beforeTokens} → ${afterTokens} tokens`
      );
      await saveCheckpoint(
        options,
        history,
        todoManager,
        toolSummaries,
        verificationSummaries,
        compactBoundaries,
        logger
      );
    }
    const messages = withTodoContext(history.getMessages(), todoManager);
    logger.debug(
      `[CONTEXT] messages=${messages.length}, approxTokens=${history.getApproxTokenCount()}`
    );
    recorder?.emit("LLMRequest", {
      turn,
      model: config.model,
      messageCount: messages.length,
      toolDefinitionCount: toolDefinitions.length,
      approxTokens: history.getApproxTokenCount(),
    });
    const response = await client.sendMessage(messages, {
      tools: toolDefinitions,
    });
    const llmElapsedMs = Date.now() - turnStartedAt;
    totalTokens += response.usage.total_tokens;
    logger.debug(
      `[TURN ${turn}] LLM response received in ${llmElapsedMs}ms`
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
    recorder?.emit("LLMResponse", {
      turn,
      model: response.model,
      toolCallCount: parsed.toolCalls.length,
      finishReason: parsed.finishReason,
      elapsedMs: llmElapsedMs,
      usage: response.usage,
    });

    if (parsed.toolCalls.length === 0) {
      await saveCheckpoint(
        options,
        history,
        todoManager,
        toolSummaries,
        verificationSummaries,
        compactBoundaries,
        logger
      );
      logger.info(`[TURN ${turn}] no tool calls; finishing`);
      recorder?.emit("Stop", {
        success: true,
        turns: turn,
        finalState: "no_tool_calls",
        totalTokens,
      });
      return {
        finalMessage: lastText,
        turnsUsed: turn,
        toolsCalled,
        success: true,
        totalTokens,
        todoDisplay: getTodoDisplay(todoManager),
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
      toolSummaries.push({ toolName: call.name, content: result.content });
      if (result.verificationMessage !== undefined) {
        history.append({
          role: "assistant",
          content: result.verificationMessage,
        });
        verificationSummaries.push({
          toolName: call.name,
          message: result.verificationMessage,
        });
      }
      await saveCheckpoint(
        options,
        history,
        todoManager,
        toolSummaries,
        verificationSummaries,
        compactBoundaries,
        logger
      );
    }
    activeHarness.endTurn();
  }

  logger.warn(`[Agent] Reached maxTurns=${config.maxTurns}; stopping`);
  recorder?.emit("Stop", {
    success: false,
    turns: config.maxTurns,
    finalState: "max_turns",
    totalTokens,
  });
  await saveCheckpoint(
    options,
    history,
    todoManager,
    toolSummaries,
    verificationSummaries,
    compactBoundaries,
    logger
  );
  return {
    finalMessage: lastText,
    turnsUsed: config.maxTurns,
    toolsCalled,
    success: false,
    totalTokens,
    todoDisplay: getTodoDisplay(todoManager),
  };
}

function createInitialMessages(
  userInput: string,
  initialMessages: Message[] | undefined
): Message[] {
  if (initialMessages === undefined || initialMessages.length === 0) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ];
  }
  const messages = [...initialMessages];
  if (messages[0]?.role !== "system") {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  if (userInput.trim() !== "") {
    messages.push({ role: "user", content: userInput });
  }
  return messages;
}

async function saveCheckpoint(
  options: AgentLoopOptions,
  history: MessageHistory,
  todoManager: TodoManager | undefined,
  toolSummaries: ToolSummary[],
  verificationSummaries: VerificationSummary[],
  compactBoundaries: CompactBoundary[],
  logger: Logger
): Promise<void> {
  if (options.checkpoint === undefined) return;
  try {
    await options.checkpoint({
      messages: history.getMessages(),
      todos: todoManager?.getAll() ?? [],
      toolSummaries: toolSummaries.map((item) => ({ ...item })),
      verificationSummaries: verificationSummaries.map((item) => ({ ...item })),
      compactBoundaries: compactBoundaries.map((item) => ({ ...item })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warning = `[session] checkpoint failed: ${message}`;
    logger.warn(warning);
    options.checkpointWarning?.(warning);
  }
}

function summarizeModelAction(toolNames: string[], text: string): string {
  if (toolNames.length > 0) return `tools: ${toolNames.join(", ")}`;
  return text.slice(0, 120);
}

function withTodoContext(
  messages: Message[],
  todoManager: TodoManager | undefined
): Message[] {
  const todoContext = todoManager?.formatForModel();
  if (todoContext === undefined || todoContext === "") return messages;
  const [firstMessage, ...remainingMessages] = messages;
  if (firstMessage === undefined) {
    return [{ role: "system", content: todoContext }];
  }
  if (firstMessage.role !== "system") {
    return [{ role: "system", content: todoContext }, ...messages];
  }
  return [
    firstMessage,
    { role: "system", content: todoContext },
    ...remainingMessages,
  ];
}

function getTodoDisplay(
  todoManager: TodoManager | undefined
): string | undefined {
  const display = todoManager?.formatForDisplay();
  return display === undefined || display === "" ? undefined : display;
}
