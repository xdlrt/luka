import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../../src/context/system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("is not empty", () => {
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it("stays concise", () => {
    expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(2000);
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

  it("does not contain placeholder text", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/TODO|TBD|PLACEHOLDER/i);
  });
});
