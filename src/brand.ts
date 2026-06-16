/**
 * Single source of truth for the project brand name and every identifier
 * derived from it. To rename the project at runtime, change `BRAND_NAME`
 * here; static files (package.json, lockfile, .gitignore, .npmignore,
 * rspress.config.ts) cannot import this module and must be updated alongside.
 */
export const BRAND_NAME = "luka";

/** Hidden working directory used for local runtime state, e.g. `.luka`. */
export const DOT_DIR = `.${BRAND_NAME}`;

/** Default directory for local observability JSONL traces. */
export const DEFAULT_OBSERVABILITY_DIR = `${DOT_DIR}/observability`;

/** Default OpenTelemetry `service.name`. */
export const OTEL_SERVICE_NAME = BRAND_NAME;

/** OpenTelemetry tracer/instrumentation scope name. */
export const OTEL_TRACER_SCOPE = `${BRAND_NAME}.observability`;

/** TUI header/title brand label. */
export const TUI_TITLE = BRAND_NAME;

/** TUI welcome banner text. */
export const TUI_WELCOME = `Welcome to ${BRAND_NAME}`;

/** Temp-directory prefix for eval task runs. */
export const EVAL_TMP_PREFIX = `${BRAND_NAME}-eval-`;
