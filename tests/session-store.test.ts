import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionStore,
  getSessionPath,
  loadSessionRecord,
  parseSessionRecord,
} from "../src/session-store.js";
import { baseConfig } from "./test-helpers.js";

describe("session store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-session-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serializes and loads a resumable session without sensitive config", async () => {
    const config = {
      ...baseConfig,
      workingDirectory: tempDir,
      apiKey: "real-api-key",
      testCommand: "npm test",
    };
    const store = createSessionStore(config, "session-a");

    await store.save({
      messages: [
        { role: "system", content: "system" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "notes.txt",
                  token: "abc123",
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: "Authorization: Bearer abc123",
        },
      ],
      todos: [{ id: "one", content: "Do it", status: "in_progress" }],
      toolSummaries: [
        { toolName: "write_file", content: "ARK_API_KEY=abc123" },
      ],
      verificationSummaries: [
        { toolName: "write_file", message: "Tests passed" },
      ],
      compactBoundaries: [
        {
          turn: 1,
          beforeTokens: 1200,
          afterTokens: 300,
          createdAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });

    const raw = await readFile(getSessionPath(tempDir, "session-a"), "utf8");
    expect(raw).not.toContain("real-api-key");
    expect(raw).not.toContain("abc123");
    expect(raw).toContain("[redacted]");

    const loaded = await loadSessionRecord(tempDir, "session-a");
    expect(loaded).toMatchObject({
      schemaVersion: 1,
      sessionId: "session-a",
      workingDirectory: tempDir,
      model: "doubao-test",
      config: {
        model: "doubao-test",
        baseURL: "https://ark.example.com/api/v3",
        testCommand: "npm test",
      },
      todos: [{ id: "one", content: "Do it", status: "in_progress" }],
      compactBoundaries: [{ turn: 1, beforeTokens: 1200, afterTokens: 300 }],
    });
  });

  it("rejects damaged JSON and invalid schema", async () => {
    const sessionPath = getSessionPath(tempDir, "bad");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, "{bad json", "utf8");

    await expect(loadSessionRecord(tempDir, "bad")).rejects.toThrow();
  });

  it("validates required fields when parsing", () => {
    expect(() => parseSessionRecord({ schemaVersion: 2 })).toThrow(
      /schemaVersion/
    );
    expect(() =>
      parseSessionRecord({
        schemaVersion: 1,
        sessionId: "s",
      })
    ).toThrow(/createdAt/);
  });
});
