import { MessageHistory } from "./message-history.js";
import { BRAND_NAME } from "../brand.js";
import type { Message } from "../types.js";

const DEFAULT_MAX_TOKENS = 100000;
const DEFAULT_COMPRESSION_THRESHOLD = 80000;
const DEFAULT_PRESERVE_LAST_N = 10;

export interface ContextCompressorConfig {
  maxTokens: number;
  compressionThreshold: number;
  preserveLastN: number;
}

export interface ContextCompressorClient {
  chat(systemPrompt: string, userMessage: string): Promise<string>;
}

export interface HistoryCompressor {
  shouldCompress(history: MessageHistory): Promise<boolean>;
  compress(history: MessageHistory): Promise<MessageHistory>;
}

export class ContextCompressor {
  private readonly config: ContextCompressorConfig;

  constructor(
    private readonly client: ContextCompressorClient,
    config: Partial<ContextCompressorConfig> = {}
  ) {
    this.config = {
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      compressionThreshold:
        config.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD,
      preserveLastN: config.preserveLastN ?? DEFAULT_PRESERVE_LAST_N,
    };
  }

  async shouldCompress(history: MessageHistory): Promise<boolean> {
    return history.getApproxTokenCount() > this.config.compressionThreshold;
  }

  async compress(history: MessageHistory): Promise<MessageHistory> {
    const messages = history.getMessages();
    const systemMessage = messages[0]?.role === "system" ? messages[0] : undefined;
    const conversationalMessages =
      systemMessage === undefined ? messages : messages.slice(1);
    const preservedTail = takeLastN(
      conversationalMessages,
      this.config.preserveLastN
    );
    const messagesToCompress = conversationalMessages.slice(
      0,
      conversationalMessages.length - preservedTail.length
    );

    if (messagesToCompress.length === 0) {
      return new MessageHistory(messages);
    }

    const summary = await this.client.chat(
      buildCompressionSystemPrompt(this.config.maxTokens),
      buildCompressionUserMessage(messagesToCompress)
    );
    const compressedMessages: Message[] = [
      ...(systemMessage === undefined ? [] : [systemMessage]),
      {
        role: "assistant",
        content: `Context summary:\n${summary}`,
      },
      ...preservedTail,
    ];
    return new MessageHistory(compressedMessages);
  }
}

function takeLastN(messages: Message[], n: number): Message[] {
  if (n <= 0) return [];
  return messages.slice(-n);
}

function buildCompressionSystemPrompt(maxTokens: number): string {
  return [
    `You are compressing an earlier ${BRAND_NAME} conversation into a compact context summary.`,
    `Keep the summary concise enough for a future prompt budget below ${maxTokens} tokens.`,
    "Preserve facts needed to continue the task correctly.",
    "Include files that were read or modified, key decisions, current task status, failures or verification results, and next steps that remain.",
    "Do not invent completed work or capabilities that are not present in the source conversation.",
  ].join("\n");
}

function buildCompressionUserMessage(messages: Message[]): string {
  return [
    "Summarize these earlier messages for continuation:",
    ...messages.map(formatMessageForSummary),
  ].join("\n\n");
}

function formatMessageForSummary(message: Message, index: number): string {
  const parts = [`Message ${index + 1}`, `role=${message.role}`];
  if (message.tool_call_id !== undefined) {
    parts.push(`tool_call_id=${message.tool_call_id}`);
  }
  if (message.tool_calls !== undefined && message.tool_calls.length > 0) {
    parts.push(
      `tool_calls=${message.tool_calls
        .map((call) => `${call.id}:${call.function.name}(${call.function.arguments})`)
        .join(", ")}`
    );
  }
  parts.push(`content=${message.content ?? ""}`);
  return parts.join("\n");
}
