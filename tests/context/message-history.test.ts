import { describe, expect, it } from "vitest";
import { MessageHistory } from "../../src/context/message-history.js";
import type { Message } from "../../src/types.js";

describe("MessageHistory", () => {
  it("appends and returns messages in order", () => {
    const history = new MessageHistory([
      { role: "system", content: "system prompt" },
    ]);

    history.append({ role: "user", content: "hello" });
    history.append({ role: "assistant", content: "hi" });

    expect(history.getMessages()).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("returns a copy of the messages array", () => {
    const history = new MessageHistory([
      { role: "user", content: "original" },
    ]);
    const messages = history.getMessages();

    messages.push({ role: "assistant", content: "external mutation" });

    expect(history.getMessages()).toEqual([
      { role: "user", content: "original" },
    ]);
  });

  it("returns the last N messages", () => {
    const history = new MessageHistory([
      { role: "system", content: "system" },
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);

    expect(history.getLastN(0)).toEqual([]);
    expect(history.getLastN(2)).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
    expect(history.getLastN(10)).toEqual(history.getMessages());
  });

  it("clears all messages", () => {
    const history = new MessageHistory([
      { role: "user", content: "hello" },
    ]);

    history.clear();

    expect(history.getMessages()).toEqual([]);
  });

  it("estimates tokens from message protocol fields", () => {
    const messages: Message[] = [
      { role: "user", content: "12345678" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "file content" },
    ];
    const history = new MessageHistory(messages);

    const expectedChars =
      "user".length +
      "12345678".length +
      "assistant".length +
      "call-1".length +
      "function".length +
      "read_file".length +
      "{\"path\":\"a.ts\"}".length +
      "tool".length +
      "call-1".length +
      "file content".length;
    expect(history.getApproxTokenCount()).toBe(Math.ceil(expectedChars / 4));
  });

  it("preserves OpenAI-compatible message fields", () => {
    const assistantMessage: Message = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "edit_file", arguments: "{\"path\":\"a.ts\"}" },
        },
      ],
    };
    const toolMessage: Message = {
      role: "tool",
      tool_call_id: "call-1",
      content: "ok",
    };
    const history = new MessageHistory([assistantMessage, toolMessage]);

    expect(history.getMessages()).toEqual([assistantMessage, toolMessage]);
  });
});
