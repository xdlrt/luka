import { randomUUID } from "node:crypto";
import path from "node:path";
import { runAgentLoop, type AgentResult } from "./agent-loop.js";
import type { AppConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import {
  DEFAULT_HOOKS_CONFIG_FILE,
  HookRuntime,
  loadHookConfig,
} from "./observability/hooks.js";
import { EventRecorder } from "./observability/recorder.js";
import {
  HttpFeedbackSink,
  LocalJsonlSink,
  type EventSink,
} from "./observability/sinks.js";
import { createDefaultToolRegistry, type ToolRegistry } from "./tools/index.js";
import { Harness, type HarnessConfig, type HarnessLike } from "./harness.js";
import { LLMClient } from "./llm-client.js";
import { ContextCompressor } from "./context/compressor.js";

const OBSERVABILITY_FLUSH_TIMEOUT_MS = 500;

export type AgentRunner = (
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  recorder?: EventRecorder
) => Promise<AgentResult>;

export interface RunAgentSessionOptions {
  runner?: AgentRunner;
  logger?: Logger;
  harnessConfig?: Partial<HarnessConfig>;
}

export interface RunAgentSessionResult extends AgentResult {}

export async function runAgentSession(
  rawInput: string,
  config: AppConfig,
  registry: ToolRegistry = createDefaultToolRegistry(config.workingDirectory),
  options: RunAgentSessionOptions = {}
): Promise<RunAgentSessionResult> {
  const userInput = rawInput.trim();
  if (userInput === "") {
    return {
      finalMessage: "",
      turnsUsed: 0,
      toolsCalled: [],
      success: true,
      totalTokens: 0,
      todoDisplay: undefined,
    };
  }

  const recorder = await createEventRecorder(config);
  try {
    recorder.emit("SessionStart", {
      workingDirectory: config.workingDirectory,
      model: config.model,
    });
    recorder.emit("UserPromptSubmit", {
      input: userInput,
      chars: userInput.length,
    });

    const result =
      options.runner === undefined
        ? await runAgentLoopWithOptions(
            userInput,
            config,
            registry,
            recorder,
            options
          )
        : await options.runner(userInput, config, registry, recorder);

    recorder.emit("SessionEnd", {
      success: result.success,
      turnsUsed: result.turnsUsed,
      toolsCalled: result.toolsCalled,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recorder.emit("SessionEnd", {
      success: false,
      error: message,
    });
    throw error;
  } finally {
    await recorder.flush?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
    await recorder.close?.({ timeoutMs: OBSERVABILITY_FLUSH_TIMEOUT_MS });
  }
}

export async function createEventRecorder(
  config: AppConfig
): Promise<EventRecorder> {
  const runId = randomUUID();
  const sinks: EventSink[] = [
    new LocalJsonlSink({
      directory: path.resolve(
        config.workingDirectory,
        config.observability.localDir
      ),
      runId,
    }),
  ];
  if (
    config.observability.feedback.enabled &&
    config.observability.feedback.url !== undefined
  ) {
    sinks.push(
      new HttpFeedbackSink({
        url: config.observability.feedback.url,
        timeoutMs: config.observability.feedback.timeoutMs,
        batchSize: config.observability.feedback.batchSize,
      })
    );
  }

  let hookConfig;
  const hooksConfigPath =
    config.hooksConfigPath ??
    path.resolve(config.workingDirectory, DEFAULT_HOOKS_CONFIG_FILE);
  try {
    hookConfig = await loadHookConfig(hooksConfigPath);
  } catch (error) {
    if (config.hooksConfigPath !== undefined || !isFileMissing(error)) {
      throw error;
    }
  }

  const recorder = new EventRecorder({ runId, sinks });
  if (hookConfig === undefined) return recorder;

  const hookRuntime = new HookRuntime(hookConfig, {
    onFailure: (event, hook, error) =>
      recorder.emitHookFailure(event, hook, error),
  });
  recorder.setHookRuntime(hookRuntime);
  return recorder;
}

function runAgentLoopWithOptions(
  userInput: string,
  config: AppConfig,
  registry: ToolRegistry,
  recorder: EventRecorder,
  options: RunAgentSessionOptions
): Promise<AgentResult> {
  const logger = options.logger ?? createLogger({ verbose: config.verbose });
  const client = new LLMClient(config);
  const harness: HarnessLike =
    options.harnessConfig === undefined
      ? Harness.fromAppConfig(config, { logger, recorder })
      : Harness.fromAppConfig(config, {
          ...options.harnessConfig,
          logger,
          recorder,
        });
  return runAgentLoop(
    userInput,
    config,
    registry,
    client,
    harness,
    logger,
    new ContextCompressor(client),
    recorder
  );
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
