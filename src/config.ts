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
  otel: {
    enabled: boolean;
    endpoint?: string;
    serviceName: string;
    timeoutMs: number;
  };
}

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_OBSERVABILITY_DIR = ".coding-agent/observability";
const DEFAULT_FEEDBACK_TIMEOUT_MS = 3000;
const DEFAULT_FEEDBACK_BATCH_SIZE = 20;
const DEFAULT_OTEL_SERVICE_NAME = "coding-agent";
const DEFAULT_OTEL_TIMEOUT_MS = 3000;

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
  const otelEndpoint =
    resolve(undefined, process.env.OBSERVABILITY_OTEL_ENDPOINT) ??
    resolve(undefined, process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) ??
    resolveOtlpTracesEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
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
    otel: {
      enabled: parseBoolean(process.env.OBSERVABILITY_OTEL_ENABLED),
      endpoint: otelEndpoint,
      serviceName:
        resolve(undefined, process.env.OBSERVABILITY_OTEL_SERVICE_NAME) ??
        DEFAULT_OTEL_SERVICE_NAME,
      timeoutMs:
        parseOptionalPositiveInteger(
          process.env.OBSERVABILITY_OTEL_TIMEOUT_MS,
          "OBSERVABILITY_OTEL_TIMEOUT_MS"
        ) ?? DEFAULT_OTEL_TIMEOUT_MS,
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
  if (config.otel.endpoint !== undefined && config.otel.endpoint.trim() === "") {
    throw new Error("Invalid observability.otel.endpoint: expected a non-empty string");
  }
  if (config.otel.serviceName.trim() === "") {
    throw new Error("Invalid observability.otel.serviceName: expected a non-empty string");
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
    otel: {
      enabled: config.otel.enabled,
      endpoint: config.otel.endpoint,
      serviceName: config.otel.serviceName,
      timeoutMs: parsePositiveInteger(
        config.otel.timeoutMs,
        "observability.otel.timeoutMs"
      ),
    },
  };
}

function resolveOtlpTracesEndpoint(raw: string | undefined): string | undefined {
  const endpoint = resolve(undefined, raw);
  if (endpoint === undefined) return undefined;
  const trimmed = endpoint.replace(/\/+$/, "");
  return `${trimmed}/v1/traces`;
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
