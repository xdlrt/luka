import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AppConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { PermissionChecker, HarnessConfig } from "../harness.js";
import {
  runAgentSession,
  type RunAgentSessionOptions,
  type RunAgentSessionResult,
} from "../session.js";
import { classifyTool } from "../permissions/categories.js";
import type { PermissionDecision } from "../permissions/index.js";
import type { ToolDefinition } from "../tools/types.js";
import type { ToolRegistry } from "../tools/index.js";

type MessageKind = "user" | "assistant" | "status" | "error";

interface TranscriptMessage {
  id: number;
  kind: MessageKind;
  content: string;
}

interface PermissionPrompt {
  toolName: string;
  message: string;
  resolve(decision: PermissionDecision): void;
}

export interface TuiAppProps {
  config: AppConfig;
  registry: ToolRegistry;
  sessionOptions?: Omit<RunAgentSessionOptions, "harnessConfig" | "logger">;
  sessionRunner?: TuiSessionRunner;
  onExit?: () => void;
}

const CANCELLED_BY_USER = "Cancelled by user";

export type TuiSessionRunner = (
  input: string,
  config: AppConfig,
  registry: ToolRegistry,
  options: RunAgentSessionOptions
) => Promise<RunAgentSessionResult>;

export function TuiApp({
  config,
  registry,
  sessionOptions,
  sessionRunner = runAgentSession,
  onExit,
}: TuiAppProps): React.ReactElement {
  const app = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [permissionPrompt, setPermissionPrompt] =
    useState<PermissionPrompt | null>(null);
  const nextMessageId = useRef(1);
  const inputRef = useRef("");
  const cursorOffsetRef = useRef(0);
  const permissionPromptRef = useRef<PermissionPrompt | null>(null);

  const updateInput = useCallback((nextInput: string, nextOffset?: number) => {
    const offset = clampOffset(nextOffset ?? nextInput.length, nextInput);
    inputRef.current = nextInput;
    cursorOffsetRef.current = offset;
    setInput(nextInput);
  }, []);

  const updatePermissionPrompt = useCallback(
    (nextPrompt: PermissionPrompt | null) => {
      permissionPromptRef.current = nextPrompt;
      setPermissionPrompt(nextPrompt);
    },
    []
  );

  const appendMessage = useCallback((kind: MessageKind, content: string) => {
    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, kind, content },
    ]);
  }, []);

  const exit = useCallback(() => {
    onExit?.();
    app.exit();
  }, [app, onExit]);

  const permissionCheck = useMemo<PermissionChecker>(
    () => async (tool: ToolDefinition, toolInput, options) => {
      const category = tool.category ?? classifyTool(tool.name);
      if (options.autoApprove === true || category === "read") {
        return { approved: true };
      }

      const message = formatPermissionMessage(tool.name, toolInput);
      return new Promise<PermissionDecision>((resolve) => {
        updatePermissionPrompt({ toolName: tool.name, message, resolve });
      });
    },
    [updatePermissionPrompt]
  );

  const submit = useCallback(
    async (rawInput: string) => {
      const userInput = rawInput.trim();
      if (userInput === "") return;
      if (userInput === ".exit") {
        exit();
        return;
      }

      appendMessage("user", userInput);
      updateInput("");
      setIsRunning(true);
      try {
        const harnessConfig: Partial<HarnessConfig> = { permissionCheck };
        const result = await sessionRunner(userInput, config, registry, {
          ...sessionOptions,
          harnessConfig,
          logger: createLogger({
            verbose: config.verbose,
            writeLine: (line) => appendMessage("status", line),
          }),
        });
        if (result.finalMessage !== "") {
          appendMessage("assistant", result.finalMessage);
        }
        if (result.todoDisplay !== undefined && result.todoDisplay !== "") {
          appendMessage("status", result.todoDisplay);
        }
        if (result.toolsCalled.length > 0) {
          appendMessage(
            "status",
            `[TUI] Tools called: ${result.toolsCalled.join(", ")}`
          );
        }
        if (!result.success) {
          appendMessage(
            "status",
            `[TUI] Stopped after ${result.turnsUsed} turns`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendMessage("error", `Error: ${message}`);
      } finally {
        setIsRunning(false);
      }
    },
    [
      appendMessage,
      config,
      exit,
      permissionCheck,
      registry,
      sessionOptions,
      sessionRunner,
      updateInput,
    ]
  );

  const answerPermission = useCallback(
    (approved: boolean) => {
      const prompt = permissionPromptRef.current;
      if (prompt === null) return;
      prompt.resolve(
        approved
          ? { approved: true }
          : { approved: false, reason: CANCELLED_BY_USER }
      );
      appendMessage(
        "status",
        approved
          ? `[PERMISSION] Approved ${prompt.toolName}`
          : `[PERMISSION] Denied ${prompt.toolName}`
      );
      updatePermissionPrompt(null);
    },
    [appendMessage, updatePermissionPrompt]
  );

  const editInput = useCallback(
    (editor: (current: string, offset: number) => InputEdit) => {
      const edit = editor(inputRef.current, cursorOffsetRef.current);
      updateInput(edit.input, edit.cursorOffset);
    },
    [updateInput]
  );

  useInput((pressedInput, key) => {
    if (permissionPromptRef.current !== null) {
      if (pressedInput.toLowerCase() === "y") {
        answerPermission(true);
      } else if (pressedInput.toLowerCase() === "n" || key.escape) {
        answerPermission(false);
      }
      return;
    }

    if (key.ctrl && (pressedInput === "c" || pressedInput === "d")) {
      exit();
      return;
    }
    if (key.return || pressedInput === "\r" || pressedInput === "\n") {
      void submit(inputRef.current);
      return;
    }
    if (isRunning) return;
    if (key.ctrl) {
      const handled = handleCtrlInput(pressedInput, editInput);
      if (handled) return;
    }
    if (key.leftArrow) {
      editInput((current, offset) => ({
        input: current,
        cursorOffset: Math.max(0, offset - 1),
      }));
      return;
    }
    if (key.rightArrow) {
      editInput((current, offset) => ({
        input: current,
        cursorOffset: Math.min(current.length, offset + 1),
      }));
      return;
    }
    if (key.home) {
      editInput((current) => ({ input: current, cursorOffset: 0 }));
      return;
    }
    if (key.end) {
      editInput((current) => ({
        input: current,
        cursorOffset: current.length,
      }));
      return;
    }
    if (key.backspace) {
      editInput((current, offset) => {
        if (offset === 0) return { input: current, cursorOffset: offset };
        return {
          input: `${current.slice(0, offset - 1)}${current.slice(offset)}`,
          cursorOffset: offset - 1,
        };
      });
      return;
    }
    if (key.delete) {
      editInput((current, offset) => {
        if (offset >= current.length) {
          return { input: current, cursorOffset: offset };
        }
        return {
          input: `${current.slice(0, offset)}${current.slice(offset + 1)}`,
          cursorOffset: offset,
        };
      });
      return;
    }
    if (key.meta || key.escape || key.tab) return;
    if (pressedInput !== "") {
      editInput((current, offset) => ({
        input: `${current.slice(0, offset)}${pressedInput}${current.slice(
          offset
        )}`,
        cursorOffset: offset + pressedInput.length,
      }));
    }
  });

  const statusText =
    permissionPrompt !== null
      ? "Waiting for permission"
      : isRunning
        ? "Running..."
        : "Ready";

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold>coding-agent</Text>
        <Text> | </Text>
        <Text>{statusText}</Text>
        <Text> | model: {config.model}</Text>
        <Text> | cwd: {config.workingDirectory}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {messages.length === 0 ? (
          <Text color="gray">输入任务后按 Enter，输入 .exit 或 Ctrl+C 退出。</Text>
        ) : (
          messages.map((message) => (
            <TranscriptLine key={message.id} message={message} />
          ))
        )}
      </Box>
      {permissionPrompt !== null ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{permissionPrompt.message}</Text>
          <Text color="yellow">
            Do you want to proceed? y/n - Esc to cancel
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <InputLine
          input={input}
          cursorOffset={cursorOffsetRef.current}
          isRunning={isRunning}
          isPermissionPending={permissionPrompt !== null}
        />
      </Box>
    </Box>
  );
}

function InputLine({
  input,
  cursorOffset,
  isRunning,
}: {
  input: string;
  cursorOffset: number;
  isRunning: boolean;
  isPermissionPending: boolean;
}): React.ReactElement {
  const prompt = "> ";
  const offset = clampOffset(cursorOffset, input);
  const beforeCursor = input.slice(0, offset);
  const cursorText = input[offset] ?? " ";
  const afterCursor = input.slice(offset + (input[offset] === undefined ? 0 : 1));

  return (
    <Box>
      <Text color={isRunning ? "gray" : "green"}>{prompt}</Text>
      {isRunning ? (
        <Text color="gray">Running...</Text>
      ) : (
        <>
          <Text>{beforeCursor}</Text>
          <Text inverse>{cursorText}</Text>
          <Text>{afterCursor}</Text>
        </>
      )}
    </Box>
  );
}

function TranscriptLine({
  message,
}: {
  message: TranscriptMessage;
}): React.ReactElement {
  const label = formatLabel(message.kind);
  const color = getMessageColor(message.kind);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>{label}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

function formatLabel(kind: MessageKind): string {
  if (kind === "user") return "You";
  if (kind === "assistant") return "Agent";
  if (kind === "error") return "Error";
  return "Status";
}

function getMessageColor(kind: MessageKind): "cyan" | "green" | "yellow" | "red" {
  if (kind === "user") return "cyan";
  if (kind === "assistant") return "green";
  if (kind === "error") return "red";
  return "yellow";
}

function formatPermissionMessage(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (toolName === "write_file") {
    return [
      `[PERMISSION] Write file: ${formatValue(input.path)}`,
      `Content preview: ${formatContentPreview(input.content)}`,
    ].join("\n");
  }

  if (toolName === "run_command") {
    return `[PERMISSION] Run command: ${formatValue(input.command)}`;
  }

  return `[PERMISSION] Execute tool: ${toolName}`;
}

function formatContentPreview(content: unknown): string {
  if (typeof content !== "string") return "<non-string content>...";
  return `${content.split(/\r?\n/).slice(0, 3).join("\n")}...`;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : "<missing>";
}

interface InputEdit {
  input: string;
  cursorOffset: number;
}

function clampOffset(offset: number, input: string): number {
  return Math.max(0, Math.min(offset, input.length));
}

function handleCtrlInput(
  pressedInput: string,
  editInput: (editor: (current: string, offset: number) => InputEdit) => void
): boolean {
  if (pressedInput === "a") {
    editInput((current) => ({ input: current, cursorOffset: 0 }));
    return true;
  }
  if (pressedInput === "e") {
    editInput((current) => ({ input: current, cursorOffset: current.length }));
    return true;
  }
  if (pressedInput === "b") {
    editInput((current, offset) => ({
      input: current,
      cursorOffset: Math.max(0, offset - 1),
    }));
    return true;
  }
  if (pressedInput === "f") {
    editInput((current, offset) => ({
      input: current,
      cursorOffset: Math.min(current.length, offset + 1),
    }));
    return true;
  }
  if (pressedInput === "u") {
    editInput((current, offset) => ({
      input: current.slice(offset),
      cursorOffset: 0,
    }));
    return true;
  }
  if (pressedInput === "k") {
    editInput((current, offset) => ({
      input: current.slice(0, offset),
      cursorOffset: offset,
    }));
    return true;
  }
  if (pressedInput === "w") {
    editInput((current, offset) => {
      const beforeCursor = current.slice(0, offset);
      const deleteFrom = findWordDeleteStart(beforeCursor);
      return {
        input: `${current.slice(0, deleteFrom)}${current.slice(offset)}`,
        cursorOffset: deleteFrom,
      };
    });
    return true;
  }
  return false;
}

function findWordDeleteStart(input: string): number {
  let index = input.length;
  while (index > 0 && /\s/.test(input[index - 1] ?? "")) {
    index--;
  }
  while (index > 0 && !/\s/.test(input[index - 1] ?? "")) {
    index--;
  }
  return index;
}
