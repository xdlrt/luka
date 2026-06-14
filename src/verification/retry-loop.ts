import type { TestResult } from "./test-runner.js";

export interface RetryConfig {
  maxRetries: number;
  testCommand: string;
}

export interface RetryHistoryEntry {
  attempt: number;
  testResult: TestResult;
  formattedResult: string;
  modelAction: string;
}

export interface RetryResult {
  success: boolean;
  attempts: number;
  finalTestResult: TestResult;
  history: RetryHistoryEntry[];
  message: string;
}

export interface RetryState {
  attempts: number;
  history: RetryHistoryEntry[];
}

export interface VerificationAttempt {
  state: RetryState;
  result: RetryResult;
  shouldRetry: boolean;
  nextMessage: string;
}

export function createRetryState(): RetryState {
  return { attempts: 0, history: [] };
}

export function recordVerificationAttempt(
  state: RetryState,
  config: RetryConfig,
  testResult: TestResult,
  formattedResult: string,
  modelAction: string
): VerificationAttempt {
  if (testResult.passed) {
    const result = buildResult(true, state, testResult, `[verification] ${formattedResult}`);
    return {
      state: createRetryState(),
      result,
      shouldRetry: false,
      nextMessage: result.message,
    };
  }

  const attempts = state.attempts + 1;
  const history = [
    ...state.history,
    {
      attempt: attempts,
      testResult,
      formattedResult,
      modelAction,
    },
  ];
  const nextState = { attempts, history };

  if (attempts >= config.maxRetries) {
    const message = `Unable to fix after ${config.maxRetries} attempts`;
    return {
      state: createRetryState(),
      result: buildResult(false, nextState, testResult, message),
      shouldRetry: false,
      nextMessage: message,
    };
  }

  const message = `Tests failed. Please fix the issues:\n${formattedResult}`;
  return {
    state: nextState,
    result: buildResult(false, nextState, testResult, message),
    shouldRetry: true,
    nextMessage: message,
  };
}

function buildResult(
  success: boolean,
  state: RetryState,
  finalTestResult: TestResult,
  message: string
): RetryResult {
  return {
    success,
    attempts: state.attempts,
    finalTestResult,
    history: state.history,
    message,
  };
}
