import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/permissions/command-classifier.js";

describe("classifyCommand", () => {
  it("classifies common read-only commands", () => {
    expect(classifyCommand("ls src").kind).toBe("read");
    expect(classifyCommand("cat README.md").kind).toBe("read");
    expect(classifyCommand("rg TODO src").kind).toBe("read");
    expect(classifyCommand("git status --short").kind).toBe("read");
  });

  it("classifies file writes and output redirection", () => {
    expect(classifyCommand("mkdir dist").kind).toBe("write");
    expect(classifyCommand("touch notes.txt").kind).toBe("write");
    expect(classifyCommand("cp a b").kind).toBe("write");
    expect(classifyCommand("echo hello > notes.txt").kind).toBe("write");
  });

  it("classifies network and git write commands", () => {
    expect(classifyCommand("curl --version").kind).toBe("network");
    expect(classifyCommand("wget --help").kind).toBe("network");
    expect(classifyCommand("git commit -m test").kind).toBe("git-write");
    expect(classifyCommand("git rebase main").kind).toBe("git-write");
  });

  it("keeps existing dangerous command rules authoritative", () => {
    expect(classifyCommand("sudo npm install")).toMatchObject({
      kind: "dangerous",
      reasons: ["Blocked: privilege escalation (sudo)"],
    });
    expect(classifyCommand("rm -rf dist").kind).toBe("dangerous");
    expect(classifyCommand("curl https://example.com").kind).toBe("dangerous");
  });

  it("uses the highest-risk classification across command segments", () => {
    expect(classifyCommand("git status && npm install").kind).toBe("write");
    expect(classifyCommand("git status && git commit -m test").kind).toBe(
      "git-write"
    );
    expect(classifyCommand("git status && rm -rf dist").kind).toBe("dangerous");
  });

  it("marks shell wrappers and command substitutions as unknown", () => {
    expect(classifyCommand("sh -c \"npm test\"").kind).toBe("unknown");
    expect(classifyCommand("node -e \"console.log(1)\"").kind).toBe("unknown");
    expect(classifyCommand("echo $(pwd)").kind).toBe("unknown");
    expect(classifyCommand("echo `pwd`").kind).toBe("unknown");
  });
});
