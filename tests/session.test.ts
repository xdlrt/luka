import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentSession } from "../src/session.js";
import { createSessionStore, getSessionPath } from "../src/session-store.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import type { Message } from "../src/types.js";
import { baseConfig } from "./test-helpers.js";

describe("runAgentSession persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-session-run-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes checkpoints for a named session", async () => {
    const registry = createDefaultToolRegistry(tempDir);
    const config = { ...baseConfig, workingDirectory: tempDir };
    mockFetchTextResponse("saved");

    await runAgentSession("hello", config, registry, {
      sessionId: "session-a",
      logger: silentLogger(),
    });

    const raw = await readFile(getSessionPath(tempDir, "session-a"), "utf8");
    expect(raw).toContain("\"sessionId\": \"session-a\"");
    expect(raw).toContain("\"messages\"");
    expect(raw).toContain("\"saved\"");
  });

  it("resumes messages and todos, then appends the new prompt", async () => {
    const config = { ...baseConfig, workingDirectory: tempDir };
    const store = createSessionStore(config, "resume-me");
    await store.save({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "first task" },
        { role: "assistant", content: "first done" },
      ],
      todos: [{ id: "one", content: "Keep context", status: "in_progress" }],
      toolSummaries: [],
      verificationSummaries: [],
      compactBoundaries: [],
    });
    const sentMessages: Message[][] = [];
    mockFetchTextResponse("second done", sentMessages);

    const result = await runAgentSession("second task", config, createDefaultToolRegistry(tempDir), {
      resumeSessionId: "resume-me",
      logger: silentLogger(),
    });

    expect(result.todoDisplay).toContain("[~] Keep context");
    expect(sentMessages[0]).toEqual(
      expect.arrayContaining([
        { role: "assistant", content: "first done" },
        { role: "user", content: "second task" },
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Current TODO state"),
        }),
      ])
    );
  });

  it("can resume without a new prompt", async () => {
    const config = { ...baseConfig, workingDirectory: tempDir };
    const store = createSessionStore(config, "resume-only");
    await store.save({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "first task" },
        { role: "assistant", content: "first done" },
      ],
      todos: [],
      toolSummaries: [],
      verificationSummaries: [],
      compactBoundaries: [],
    });
    const sentMessages: Message[][] = [];
    mockFetchTextResponse("continued", sentMessages);

    const result = await runAgentSession("", config, createDefaultToolRegistry(tempDir), {
      resumeSessionId: "resume-only",
      logger: silentLogger(),
    });

    expect(result.finalMessage).toBe("continued");
    expect(sentMessages[0]).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "first task" },
      { role: "assistant", content: "first done" },
    ]);
  });
});

function mockFetchTextResponse(content: string, sentMessages: Message[][] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Message[] };
      sentMessages.push(body.messages);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            id: "chatcmpl-session",
            object: "chat.completion",
            created: 1,
            model: "doubao-test",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
      } as Response;
    })
  );
}

function silentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
