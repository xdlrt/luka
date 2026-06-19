import { randomUUID } from "node:crypto";
import path from "node:path";
import { runAgentLoop, type AgentResult } from "./agent-loop.js";
import type { AppConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import {
  DEFAULT_HOOKS_CONFIG_FILE,
  HookRuntime,
  loadHookConfig,
  summarizeHookConfig,
  type HookSummary,
} from "./observability/hooks.js";
import { EventRecorder } from "./observability/recorder.js";
import {
  HttpFeedbackSink,
  LocalJsonlSink,
  type EventSink,
} from "./observability/sinks.js";
import { OtelTraceSink } from "./observability/otel.js";
import { createDefaultToolRegistry, type ToolRegistry } from "./tools/index.js";
import { Harness, type HarnessConfig, type HarnessLike } from "./harness.js";
import { LLMClient } from "./llm-client.js";
import { ContextCompressor } from "./context/compressor.js";
import {
  createSessionStore,
  loadSessionRecord,
  type SessionRecord,
  type SessionStore,
} from "./session-store.js";

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
  sessionId?: string;
  resumeSessionId?: string;
  onCheckpointWarning?: (message: string) => void;
}

export interface RunAgentSessionResult extends AgentResult {}

export async function runAgentSession(
  rawInput: string,
  config: AppConfig,
  registry: ToolRegistry = createDefaultToolRegistry(config.workingDirectory),
  options: RunAgentSessionOptions = {}
): Promise<RunAgentSessionResult> {
  const userInput = rawInput.trim();
  if (userInput === "" && options.resumeSessionId === undefined) {
    return {
      finalMessage: "",
      turnsUsed: 0,
      toolsCalled: [],
      success: true,
      totalTokens: 0,
      todoDisplay: undefined,
    };
  }

  const resumedSession =
    options.resumeSessionId === undefined
      ? undefined
      : await loadSessionRecord(config.workingDirectory, options.resumeSessionId);
  const sessionId = options.sessionId ?? options.resumeSessionId;
  const sessionStore =
    sessionId === undefined
      ? undefined
      : createSessionStore(config, sessionId, resumedSession);
  if (resumedSession !== undefined) {
    registry.getTodoManager()?.update(resumedSession.todos);
  }

  const { recorder, hookSummary, hooksConfigPath } = await createEventRecorder(
    config
  );
  try {
    recorder.emit("SessionStart", {
      source: "cli",
      workingDirectory: config.workingDirectory,
      model: config.model,
      hooksConfigPath,
      hooksConfigured: hookSummary.hookCommandCount > 0,
      hookEventCount: hookSummary.hookEventCount,
      hookCommandCount: hookSummary.hookCommandCount,
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
            options,
            resumedSession,
            sessionStore
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
): Promise<{
  recorder: EventRecorder;
  hookSummary: HookSummary;
  hooksConfigPath: string;
}> {
  const runId = randomUUID();
  const { localSink, sinks } = createObservabilitySinks(config, runId);

  const hooksConfigPath =
    config.hooksConfigPath ??
    path.resolve(config.workingDirectory, DEFAULT_HOOKS_CONFIG_FILE);
  let hookConfig;
  try {
    hookConfig = await loadHookConfig(hooksConfigPath);
  } catch (error) {
    if (config.hooksConfigPath !== undefined || !isFileMissing(error)) {
      throw error;
    }
  }

  const recorder = new EventRecorder({ runId, sinks });
  if (hookConfig === undefined) {
    return {
      recorder,
      hookSummary: { hookEventCount: 0, hookCommandCount: 0 },
      hooksConfigPath,
    };
  }

  const hookRuntime = new HookRuntime(hookConfig, {
    onFailure: (event, hook, error) =>
      recorder.emitHookFailure(event, hook, error),
    onHookEvent: (type, payload) => recorder.emit(type, payload),
    sessionId: runId,
    transcriptPath: localSink.path,
    cwd: config.workingDirectory,
  });
  recorder.setHookRuntime(hookRuntime);
  return {
    recorder,
    hookSummary: summarizeHookConfig(hookConfig),
    hooksConfigPath,
  };
}

export function createObservabilitySinks(
  config: AppConfig,
  runId: string,
  options: { localDirectory?: string } = {}
): { localSink: LocalJsonlSink; sinks: EventSink[] } {
  const localSink = new LocalJsonlSink({
    directory:
      options.localDirectory ??
      path.resolve(config.workingDirectory, config.observability.localDir),
    runId,
  });
  const sinks: EventSink[] = [
    localSink,
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
  if (
    config.observability.otel.enabled &&
    config.observability.otel.endpoint !== undefined
  ) {
    sinks.push(
      new OtelTraceSink({
        endpoint: config.observability.otel.endpoint,
        serviceName: config.observability.otel.serviceName,
        timeoutMs: config.observability.otel.timeoutMs,
      })
    );
  }

  return { localSink, sinks };
}

function runAgentLoopWithOptions(
  userInput: string,
  config: AppConfig,
  registry: ToolRegistry,
  recorder: EventRecorder,
  options: RunAgentSessionOptions,
  resumedSession: SessionRecord | undefined,
  sessionStore: SessionStore | undefined
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
    recorder,
    {
      initialMessages: resumedSession?.messages,
      checkpoint:
        sessionStore === undefined
          ? undefined
          : async (checkpoint) => {
              await sessionStore.save(checkpoint);
            },
      checkpointWarning: options.onCheckpointWarning,
    }
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
