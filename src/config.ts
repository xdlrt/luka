import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTurns: number;
  workingDirectory: string;
  autoApprove: boolean;
  testCommand?: string;
  maxRetries: number;
  verbose: boolean;
  hooksConfigPath?: string;
  observability: ObservabilityConfig;
}

export interface ObservabilityConfig {
  localDir: string;
  feedback: {
    enabled: boolean;
    url?: string;
    timeoutMs: number;
    batchSize: number;
  };
}

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_OBSERVABILITY_DIR = ".coding-agent/observability";
const DEFAULT_FEEDBACK_TIMEOUT_MS = 3000;
const DEFAULT_FEEDBACK_BATCH_SIZE = 20;

function resolve(
  overrideValue: string | undefined,
  envValue: string | undefined
): string | undefined {
  if (overrideValue !== undefined) return overrideValue;
  const trimmed = envValue?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotenv();

  const apiKey = resolve(overrides.apiKey, process.env.ARK_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Missing API key: set ARK_API_KEY in environment or .env"
    );
  }

  const model = resolve(overrides.model, process.env.ARK_MODEL);
  if (!model) {
    throw new Error(
      "Missing model: set ARK_MODEL in environment or .env"
    );
  }

  let maxTurns = DEFAULT_MAX_TURNS;
  if (overrides.maxTurns !== undefined) {
    maxTurns = overrides.maxTurns;
  } else {
    const raw = process.env.MAX_TURNS?.trim();
    if (raw) {
      maxTurns = parsePositiveInteger(raw, "MAX_TURNS");
    }
  }

  const maxRetries =
    overrides.maxRetries !== undefined
      ? parsePositiveInteger(overrides.maxRetries, "maxRetries")
      : parseOptionalPositiveInteger(process.env.MAX_RETRIES, "MAX_RETRIES") ??
        DEFAULT_MAX_RETRIES;
  const baseURL =
    resolve(overrides.baseURL, process.env.BASE_URL) ?? DEFAULT_BASE_URL;
  const workingDirectory = overrides.workingDirectory ?? process.cwd();
  const autoApprove = overrides.autoApprove ?? false;
  const testCommand = resolve(overrides.testCommand, process.env.TEST_COMMAND);
  const verbose = overrides.verbose ?? parseBoolean(process.env.VERBOSE);
  const hooksConfigPath = resolve(
    overrides.hooksConfigPath,
    process.env.HOOKS_CONFIG
  );
  const observability =
    overrides.observability !== undefined
      ? validateObservabilityConfig(overrides.observability)
      : loadObservabilityConfigFromEnv();

  return {
    apiKey,
    baseURL,
    model,
    maxTurns,
    workingDirectory,
    autoApprove,
    testCommand,
    maxRetries,
    verbose,
    hooksConfigPath,
    observability,
  };
}

function loadObservabilityConfigFromEnv(): ObservabilityConfig {
  const feedbackUrl = resolve(undefined, process.env.OBSERVABILITY_FEEDBACK_URL);
  return {
    localDir:
      resolve(undefined, process.env.OBSERVABILITY_DIR) ??
      DEFAULT_OBSERVABILITY_DIR,
    feedback: {
      enabled: feedbackUrl !== undefined,
      url: feedbackUrl,
      timeoutMs:
        parseOptionalPositiveInteger(
          process.env.OBSERVABILITY_FEEDBACK_TIMEOUT_MS,
          "OBSERVABILITY_FEEDBACK_TIMEOUT_MS"
        ) ?? DEFAULT_FEEDBACK_TIMEOUT_MS,
      batchSize:
        parseOptionalPositiveInteger(
          process.env.OBSERVABILITY_FEEDBACK_BATCH_SIZE,
          "OBSERVABILITY_FEEDBACK_BATCH_SIZE"
        ) ?? DEFAULT_FEEDBACK_BATCH_SIZE,
    },
  };
}

function validateObservabilityConfig(
  config: ObservabilityConfig
): ObservabilityConfig {
  if (config.localDir.trim() === "") {
    throw new Error("Invalid observability.localDir: expected a non-empty string");
  }
  if (config.feedback.url !== undefined && config.feedback.url.trim() === "") {
    throw new Error("Invalid observability.feedback.url: expected a non-empty string");
  }
  return {
    localDir: config.localDir,
    feedback: {
      enabled: config.feedback.enabled,
      url: config.feedback.url,
      timeoutMs: parsePositiveInteger(
        config.feedback.timeoutMs,
        "observability.feedback.timeoutMs"
      ),
      batchSize: parsePositiveInteger(
        config.feedback.batchSize,
        "observability.feedback.batchSize"
      ),
    },
  };
}

function parseOptionalPositiveInteger(
  raw: string | undefined,
  name: string
): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return parsePositiveInteger(trimmed, name);
}

function parsePositiveInteger(raw: string | number, name: string): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive integer, got "${raw}"`
    );
  }
  return parsed;
}

function parseBoolean(raw: string | undefined): boolean {
  const trimmed = raw?.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true";
}
