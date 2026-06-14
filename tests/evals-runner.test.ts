import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTasks,
  runEvalSuite,
  runEvalTask,
  type AgentRunner,
} from "../src/evals/runner.js";
import type { EvalTask } from "../src/evals/types.js";

describe("eval runner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-evals-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads tasks from JSON files in sorted order", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    await writeTask(tasksDir, "02.json", createTask("02-task"));
    await writeTask(tasksDir, "01.json", createTask("01-task"));

    const tasks = await loadTasks(tasksDir);

    expect(tasks.map((task) => task.id)).toEqual(["01-task", "02-task"]);
  });

  it("runs a task, checks file expectations, and cleans temp dirs", async () => {
    const runner: AgentRunner = vi.fn(async (_input, config) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      return {
        finalMessage: "done",
        turnsUsed: 2,
        toolsCalled: ["write_file"],
        success: true,
      };
    });

    const result = await runEvalTask(createTask("01-create-file"), runner);

    expect(result.passed).toBe(true);
    expect(result.task_id).toBe("01-create-file");
    expect(runner).toHaveBeenCalledTimes(1);
    await expectNoEvalTempDir("01-create-file");
  });

  it("reports failed expectations", async () => {
    const runner: AgentRunner = vi.fn(async () => ({
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
    }));

    const result = await runEvalTask(createTask("missing-file"), runner);

    expect(result.passed).toBe(false);
    expect(result.failure_reason).toMatch(/expected file missing/);
  });

  it("writes suite results for --all", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    const runner: AgentRunner = vi.fn(async (_input, config) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      return {
        finalMessage: "done",
        turnsUsed: 1,
        toolsCalled: ["write_file"],
        success: true,
      };
    });

    const result = await runEvalSuite({
      all: true,
      tasksDir,
      resultsDir,
      runner,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.passed).toBe(true);
    const saved = await readFile(
      path.join(resultsDir, `${result.run_id}.json`),
      "utf8"
    );
    expect(saved).toContain("01-create-file");
  });

  it("runs a selected task only", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    await writeTask(tasksDir, "02.json", createTask("02-other"));
    const runner: AgentRunner = vi.fn(async (_input, config) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      return {
        finalMessage: "done",
        turnsUsed: 1,
        toolsCalled: ["write_file"],
        success: true,
      };
    });

    const result = await runEvalSuite({
      taskId: "02-other",
      tasksDir,
      resultsDir,
      runner,
    });

    expect(result.results.map((item) => item.task_id)).toEqual(["02-other"]);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

function createTask(id: string): EvalTask {
  return {
    id,
    description: "Create notes",
    difficulty: "easy",
    prompt: "Create notes.txt",
    setup: { files: {} },
    expectations: {
      files: [{ path: "notes.txt", contains: ["done"] }],
    },
  };
}

async function writeTask(
  tasksDir: string,
  fileName: string,
  task: EvalTask
): Promise<void> {
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    path.join(tasksDir, fileName),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8"
  );
}

async function expectNoEvalTempDir(taskId: string): Promise<void> {
  const entries = await readdir(os.tmpdir());
  expect(
    entries.some((entry) => entry.startsWith(`coding-agent-eval-${taskId}-`))
  ).toBe(false);
}
