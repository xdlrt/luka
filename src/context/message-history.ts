import type { Message, ToolCall } from "../types.js";

const CHARS_PER_TOKEN = 4;

export class MessageHistory {
  private readonly messages: Message[];

  constructor(initialMessages: Message[] = []) {
    this.messages = [...initialMessages];
  }

  append(message: Message): void {
    this.messages.push(message);
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getApproxTokenCount(): number {
    const chars = this.messages.reduce(
      (total, message) => total + countMessageChars(message),
      0
    );
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  getLastN(n: number): Message[] {
    if (n <= 0) return [];
    return this.messages.slice(-n);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

function countMessageChars(message: Message): number {
  return (
    message.role.length +
    countOptionalString(message.content) +
    countOptionalString(message.tool_call_id) +
    countToolCalls(message.tool_calls)
  );
}

function countToolCalls(toolCalls: ToolCall[] | undefined): number {
  if (toolCalls === undefined) return 0;
  return toolCalls.reduce(
    (total, call) =>
      total +
      call.id.length +
      call.type.length +
      call.function.name.length +
      call.function.arguments.length,
    0
  );
}

function countOptionalString(value: string | null | undefined): number {
  return value?.length ?? 0;
}
