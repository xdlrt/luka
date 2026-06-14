import { describe, expect, it, vi } from "vitest";
import { ContextCompressor } from "../../src/context/compressor.js";
import { MessageHistory } from "../../src/context/message-history.js";
import type { Message } from "../../src/types.js";

function createCompressor(options: {
  summary?: string;
  threshold?: number;
  preserveLastN?: number;
} = {}): {
  compressor: ContextCompressor;
  chat: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn(async () => options.summary ?? "summary text");
  return {
    compressor: new ContextCompressor(
      { chat },
      {
        compressionThreshold: options.threshold ?? 10,
        maxTokens: 100,
        preserveLastN: options.preserveLastN ?? 2,
      }
    ),
    chat,
  };
}

describe("ContextCompressor", () => {
  it("detects when approximate token count exceeds the threshold", async () => {
    const { compressor } = createCompressor({ threshold: 3 });

    await expect(
      compressor.shouldCompress(
        new MessageHistory([{ role: "user", content: "short" }])
      )
    ).resolves.toBe(false);
    await expect(
      compressor.shouldCompress(
        new MessageHistory([{ role: "user", content: "a much longer message" }])
      )
    ).resolves.toBe(true);
  });

  it("compresses earlier messages into a context summary", async () => {
    const longContent = "x".repeat(200);
    const { compressor } = createCompressor({
      summary: "Read src/a.ts and decided to keep API stable.",
      preserveLastN: 1,
    });
    const history = new MessageHistory([
      { role: "system", content: "system prompt" },
      { role: "user", content: longContent },
      { role: "assistant", content: longContent },
      { role: "user", content: "latest task" },
    ]);

    const compressed = await compressor.compress(history);

    expect(compressed.getApproxTokenCount()).toBeLessThan(
      history.getApproxTokenCount()
    );
    expect(compressed.getMessages()).toEqual([
      { role: "system", content: "system prompt" },
      {
        role: "assistant",
        content:
          "Context summary:\nRead src/a.ts and decided to keep API stable.",
      },
      { role: "user", content: "latest task" },
    ]);
  });

  it("preserves the last N non-system messages unchanged", async () => {
    const toolCallMessage: Message = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" },
        },
      ],
    };
    const toolResultMessage: Message = {
      role: "tool",
      tool_call_id: "call-1",
      content: "file content",
    };
    const { compressor } = createCompressor({ preserveLastN: 2 });

    const compressed = await compressor.compress(
      new MessageHistory([
        { role: "system", content: "system" },
        { role: "user", content: "old" },
        toolCallMessage,
        toolResultMessage,
      ])
    );

    expect(compressed.getMessages().slice(-2)).toEqual([
      toolCallMessage,
      toolResultMessage,
    ]);
  });

  it("returns equivalent history without calling the model when nothing can be compressed", async () => {
    const { compressor, chat } = createCompressor({ preserveLastN: 10 });
    const messages: Message[] = [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
    ];

    const compressed = await compressor.compress(new MessageHistory(messages));

    expect(compressed.getMessages()).toEqual(messages);
    expect(chat).not.toHaveBeenCalled();
  });

  it("asks the model to preserve coding continuation details", async () => {
    const { compressor, chat } = createCompressor({ preserveLastN: 1 });

    await compressor.compress(
      new MessageHistory([
        { role: "system", content: "system" },
        { role: "user", content: "old task" },
        { role: "assistant", content: "latest" },
      ])
    );

    expect(chat).toHaveBeenCalledWith(
      expect.stringContaining("files that were read or modified"),
      expect.stringContaining("Summarize these earlier messages")
    );
    expect(chat).toHaveBeenCalledWith(
      expect.stringContaining("key decisions"),
      expect.stringContaining("role=user")
    );
    expect(chat).toHaveBeenCalledWith(
      expect.stringContaining("current task status"),
      expect.any(String)
    );
  });
});
