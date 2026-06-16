import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPathInSandbox,
  resolvePathInSandbox,
} from "../../src/permissions/sandbox.js";

describe("checkPathInSandbox", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-sandbox-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows a simple relative path inside the working directory", () => {
    const decision = checkPathInSandbox(tempDir, "src/index.ts");

    expect(decision).toEqual({
      allowed: true,
      resolvedPath: path.join(tempDir, "src/index.ts"),
      relativePath: path.join("src", "index.ts"),
    });
  });

  it("allows a nested relative path", () => {
    const decision = checkPathInSandbox(tempDir, "nested/file.txt");

    expect(decision).toEqual({
      allowed: true,
      resolvedPath: path.join(tempDir, "nested/file.txt"),
      relativePath: path.join("nested", "file.txt"),
    });
  });

  it("treats the current directory as the sandbox root", () => {
    const decision = checkPathInSandbox(tempDir, ".");

    expect(decision).toEqual({
      allowed: true,
      resolvedPath: path.resolve(tempDir),
      relativePath: "",
    });
  });

  it("allows a path that uses .. but stays inside the root", () => {
    const decision = checkPathInSandbox(tempDir, "nested/../file.txt");

    expect(decision).toEqual({
      allowed: true,
      resolvedPath: path.join(tempDir, "file.txt"),
      relativePath: "file.txt",
    });
  });

  it("rejects a path that escapes the root via ..", () => {
    const decision = checkPathInSandbox(tempDir, "../outside.txt");

    expect(decision).toEqual({
      allowed: false,
      reason: "path escapes the working directory",
    });
  });

  it("rejects a deeply nested traversal that escapes the root", () => {
    const decision = checkPathInSandbox(tempDir, "nested/../../outside.txt");

    expect(decision).toEqual({
      allowed: false,
      reason: "path escapes the working directory",
    });
  });

  it("rejects absolute paths", () => {
    const decision = checkPathInSandbox(tempDir, "/etc/passwd");

    expect(decision).toEqual({
      allowed: false,
      reason:
        "absolute paths are not allowed; use a path inside the working directory",
    });
  });

  it("rejects non-string input", () => {
    expect(checkPathInSandbox(tempDir, 123)).toEqual({
      allowed: false,
      reason: "path must be a non-empty string",
    });
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(checkPathInSandbox(tempDir, "")).toEqual({
      allowed: false,
      reason: "path must be a non-empty string",
    });
    expect(checkPathInSandbox(tempDir, "   ")).toEqual({
      allowed: false,
      reason: "path must be a non-empty string",
    });
  });

  it("does not treat a sibling directory with a shared prefix as inside the root", () => {
    const root = path.join(tempDir, "app");
    const decision = checkPathInSandbox(root, "../app2/secret.txt");

    expect(decision).toEqual({
      allowed: false,
      reason: "path escapes the working directory",
    });
  });

  it("allows a symlink path without following its target", async () => {
    const target = path.join(tempDir, "real.txt");
    await writeFile(target, "data", "utf8");
    await symlink(target, path.join(tempDir, "link.txt"));

    const decision = checkPathInSandbox(tempDir, "link.txt");

    expect(decision).toEqual({
      allowed: true,
      resolvedPath: path.join(tempDir, "link.txt"),
      relativePath: "link.txt",
    });
  });
});

describe("resolvePathInSandbox", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-sandbox-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns the resolved path for a valid relative path", () => {
    expect(resolvePathInSandbox(tempDir, "src/index.ts")).toBe(
      path.join(tempDir, "src/index.ts")
    );
  });

  it("throws with the escape reason when the path leaves the root", () => {
    expect(() => resolvePathInSandbox(tempDir, "../outside.txt")).toThrow(
      "path escapes the working directory"
    );
  });

  it("throws with the absolute reason for absolute paths", () => {
    expect(() => resolvePathInSandbox(tempDir, "/etc/passwd")).toThrow(
      "absolute paths are not allowed; use a path inside the working directory"
    );
  });

  it("throws with the non-empty reason for invalid input", () => {
    expect(() => resolvePathInSandbox(tempDir, "")).toThrow(
      "path must be a non-empty string"
    );
  });
});
