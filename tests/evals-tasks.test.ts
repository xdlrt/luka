import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTasks } from "../src/evals/runner.js";

const TASKS_DIR = path.resolve(process.cwd(), "evals/tasks");
const P3_TASK_IDS = [
  "06-grep-fix",
  "07-add-patterned-function",
  "08-cross-file-rename",
  "09-add-tests-for-module",
  "10-implement-from-spec",
];

describe("eval task catalog", () => {
  it("includes P2 and P3 tasks in sorted order", async () => {
    const tasks = await loadTasks(TASKS_DIR);

    expect(tasks.map((task) => task.id)).toEqual([
      "01-create-file",
      "02-fix-typo",
      "03-fix-logic-bug",
      "04-add-function",
      "05-refactor",
      ...P3_TASK_IDS,
    ]);
  });

  it("defines P3 multi-file tasks with executable test expectations", async () => {
    const tasks = await loadTasks(TASKS_DIR);
    const p3Tasks = tasks.filter((task) => P3_TASK_IDS.includes(task.id));

    expect(p3Tasks).toHaveLength(P3_TASK_IDS.length);
    for (const task of p3Tasks) {
      expect(Object.keys(task.setup.files).length).toBeGreaterThanOrEqual(3);
      expect(task.testCommand).toMatch(/^node /);
      expect(task.expectations.testsPassing).toBe(true);
    }
  });

  it("uses task ids that match their file names", async () => {
    const tasks = await loadTasks(TASKS_DIR);
    const ids = new Set(tasks.map((task) => task.id));

    for (const id of P3_TASK_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
