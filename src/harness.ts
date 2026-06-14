import type { AppConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import {
  checkToolPermission,
  type PermissionDecision,
} from "./permissions/index.js";
import { checkCommandSafety } from "./permissions/rules.js";
import { checkPathInSandbox } from "./permissions/sandbox.js";
import type { ToolRegistry } from "./tools/index.js";
import type { ToolDefinition } from "./tools/types.js";
import type { ToolResult } from "./types.js";
import { formatTestResults } from "./verification/format-results.js";
import {
  createRetryState,
  recordVerificationAttempt,
  type RetryState,
} from "./verification/retry-loop.js";
import { runTests, type TestResult } from "./verification/test-runner.js";

const EDIT_TOOL_NAMES = new Set(["write_file", "edit_file"]);
const PATH_SCOPED_TOOL_NAMES = new Set(["read_file", "write_file", "edit_file"]);

export type PermissionChecker = (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  options: { autoApprove?: boolean }
) => Promise<PermissionDecision>;

export type TestRunner = (command: string, cwd: string) => Promise<TestResult>;

export type HarnessDecision =
  | { proceed: true }
  | { proceed: false; reason: string };

export interface PostExecuteAction {
  verificationMessage?: string;
}

export interface HarnessExecutionResult {
  content: string;
  verificationMessage?: string;
}

export interface HarnessLike {
  beginTurn(): void;
  executeTool(
    toolName: string,
    input: Record<string, unknown>,
    tools: ToolRegistry,
    modelAction: string
  ): Promise<HarnessExecutionResult>;
  endTurn(): void;
}

export interface HarnessConfig {
  workingDirectory: string;
  autoApprove: boolean;
  testCommand?: string;
  maxRetries: number;
  permissionCheck?: PermissionChecker;
  testRunner?: TestRunner;
  logger?: Logger;
}

export class Harness implements HarnessLike {
  private retryState: RetryState = createRetryState();
  private editedThisTurn = false;
  private readonly permissionCheck: PermissionChecker;
  private readonly testRunner: TestRunner;
  private readonly logger: Logger;

  constructor(private readonly config: HarnessConfig) {
    this.permissionCheck = config.permissionCheck ?? checkToolPermission;
    this.testRunner = config.testRunner ?? runTests;
    this.logger = config.logger ?? createLogger({ verbose: false });
  }

  static fromAppConfig(
    config: AppConfig,
    overrides: Partial<HarnessConfig> = {}
  ): Harness {
    return new Harness({
      workingDirectory: config.workingDirectory,
      autoApprove: config.autoApprove,
      testCommand: config.testCommand,
      maxRetries: config.maxRetries,
      ...overrides,
    });
  }

  beginTurn(): void {
    this.editedThisTurn = false;
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    tools: ToolRegistry,
    modelAction: string
  ): Promise<HarnessExecutionResult> {
    try {
      const tool = tools.get(toolName);
      if (tool === undefined) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      this.logger.info(`[Tool: ${toolName}] ${formatToolInput(input)}`);
      const decision = await this.preExecute(tool, input);
      if (!decision.proceed) {
        return { content: decision.reason };
      }

      const result = await tools.execute(toolName, input);
      const content = formatToolResult(result);
      const action = await this.postExecute(toolName, result, modelAction);
      return {
        content,
        verificationMessage: action.verificationMessage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `[error] ${message}` };
    }
  }

  endTurn(): void {
    if (!this.editedThisTurn) {
      this.retryState = createRetryState();
    }
  }

  async preExecute(
    tool: ToolDefinition,
    input: Record<string, unknown>
  ): Promise<HarnessDecision> {
    const safety = checkToolSafety(tool, input, {
      workingDirectory: this.config.workingDirectory,
    });
    if (!safety.proceed) {
      return safety;
    }

    const permission = await this.permissionCheck(tool, input, {
      autoApprove: this.config.autoApprove,
    });
    if (!permission.approved) {
      return {
        proceed: false,
        reason: `[permission denied] ${permission.reason}`,
      };
    }

    return { proceed: true };
  }

  async postExecute(
    toolName: string,
    result: ToolResult,
    modelAction: string
  ): Promise<PostExecuteAction> {
    if (result.error !== undefined || !EDIT_TOOL_NAMES.has(toolName)) {
      return {};
    }

    this.editedThisTurn = true;
    if (this.config.testCommand === undefined) {
      return {};
    }

    const verificationStartedAt = Date.now();
    const testResult = await this.testRunner(
      this.config.testCommand,
      this.config.workingDirectory
    );
    const summary = formatTestResults(testResult);
    const verification = recordVerificationAttempt(
      this.retryState,
      {
        maxRetries: this.config.maxRetries,
        testCommand: this.config.testCommand,
      },
      testResult,
      summary,
      modelAction
    );
    this.retryState = verification.state;
    this.logger.debug(
      `[VERIFY] completed in ${Date.now() - verificationStartedAt}ms`
    );
    if (testResult.passed) {
      this.logger.info("[VERIFY] Tests passed");
    } else {
      this.logger.info(
        `[VERIFY] Tests failed (attempt ${verification.result.attempts}/${this.config.maxRetries}): ${summarizeFailure(summary)}`
      );
    }

    return { verificationMessage: verification.nextMessage };
  }
}

function checkToolSafety(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  options: { workingDirectory: string }
): HarnessDecision {
  if (PATH_SCOPED_TOOL_NAMES.has(tool.name)) {
    const sandbox = checkPathInSandbox(options.workingDirectory, input.path);
    if (!sandbox.allowed) {
      return { proceed: false, reason: `[blocked] ${sandbox.reason}` };
    }
  }

  if (tool.name === "run_command") {
    const commandSafety = checkCommandSafety(input.command);
    if (!commandSafety.allowed) {
      return { proceed: false, reason: `[blocked] ${commandSafety.reason}` };
    }
  }

  return { proceed: true };
}

function formatToolResult(result: ToolResult): string {
  return result.error
    ? `${result.output}\n[error] ${result.error}`
    : result.output;
}

function formatToolInput(input: Record<string, unknown>): string {
  const path = input.path;
  if (typeof path === "string" && path !== "") return `path=${path}`;
  const command = input.command;
  if (typeof command === "string" && command !== "") return `command=${command}`;
  return "";
}

function summarizeFailure(summary: string): string {
  const firstLine = summary.split("\n")[0];
  return firstLine.trim() === "" ? "failed" : firstLine;
}
