import path from "node:path";

export type SandboxDecision =
  | { allowed: true; resolvedPath: string; relativePath: string }
  | { allowed: false; reason: string };

export function checkPathInSandbox(
  workingDirectory: string,
  inputPath: unknown
): SandboxDecision {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    return {
      allowed: false,
      reason: "path must be a non-empty string",
    };
  }

  if (path.isAbsolute(inputPath)) {
    return {
      allowed: false,
      reason: "absolute paths are not allowed; use a path inside the working directory",
    };
  }

  const root = path.resolve(workingDirectory);
  const resolvedPath = path.resolve(root, inputPath);
  const relativePath = path.relative(root, resolvedPath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    return {
      allowed: false,
      reason: "path escapes the working directory",
    };
  }

  return { allowed: true, resolvedPath, relativePath };
}

export function resolvePathInSandbox(
  workingDirectory: string,
  inputPath: unknown
): string {
  const decision = checkPathInSandbox(workingDirectory, inputPath);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  return decision.resolvedPath;
}
