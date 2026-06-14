import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../../src/context/system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("is not empty", () => {
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it("stays concise", () => {
    expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(3000);
  });

  it("contains the required role, tool, and safety guidance", () => {
    expect(SYSTEM_PROMPT).toContain(
      "你是一个 Coding Agent，帮助用户编写和修改代码"
    );
    expect(SYSTEM_PROMPT).toContain(
      "优先使用工具获取信息，不要凭空猜测文件内容"
    );
    expect(SYSTEM_PROMPT).toContain("不要执行破坏性操作");
  });

  it("contains search workflow guidance", () => {
    expect(SYSTEM_PROMPT).toContain("先用 glob 了解文件结构");
    expect(SYSTEM_PROMPT).toContain("查找符号、函数、错误文本或配置项时用 grep");
    expect(SYSTEM_PROMPT).toContain("read_file 阅读目标文件的完整上下文");
    expect(SYSTEM_PROMPT).toContain(
      "glob 定位文件 → grep 找相关代码 → read_file 获取上下文 → edit_file 修改"
    );
  });

  it("contains planning guidance", () => {
    expect(SYSTEM_PROMPT).toContain("3 步以上任务");
    expect(SYSTEM_PROMPT).toContain("todo_write");
    expect(SYSTEM_PROMPT).toContain("最多保持一个 in_progress");
    expect(SYSTEM_PROMPT).toContain("标记为 completed");
  });

  it("does not contain placeholder text", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/TBD|PLACEHOLDER/i);
  });
});
