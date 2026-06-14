import { describe, expect, it } from "vitest";
import {
  checkCommandSafety,
  DANGEROUS_COMMAND_RULES,
} from "../../src/permissions/rules.js";

function expectBlocked(
  command: unknown,
  ruleId: string,
  reason: string
): void {
  expect(checkCommandSafety(command)).toEqual({
    allowed: false,
    ruleId,
    reason,
  });
}

function expectAllowed(command: unknown): void {
  expect(checkCommandSafety(command)).toEqual({ allowed: true });
}

describe("checkCommandSafety", () => {
  it("rejects missing or empty commands", () => {
    expectBlocked(
      undefined,
      "invalid-command",
      "Blocked: run_command requires a non-empty string command"
    );
    expectBlocked(
      "",
      "invalid-command",
      "Blocked: run_command requires a non-empty string command"
    );
    expectBlocked(
      "   ",
      "invalid-command",
      "Blocked: run_command requires a non-empty string command"
    );
    expectBlocked(
      123,
      "invalid-command",
      "Blocked: run_command requires a non-empty string command"
    );
  });

  it("blocks recursive rm commands without blocking non-recursive deletion", () => {
    expectBlocked(
      "rm -rf dist",
      "recursive-delete",
      "Blocked: destructive file deletion (rm -rf)"
    );
    expectBlocked(
      "rm -fr dist",
      "recursive-delete",
      "Blocked: destructive file deletion (rm -rf)"
    );
    expectBlocked(
      "rm -R dist",
      "recursive-delete",
      "Blocked: destructive file deletion (rm -rf)"
    );

    expectAllowed("rm dist/output.txt");
    expectAllowed("printf 'rm -rf is dangerous'");
  });

  it("blocks curl and wget URL requests without blocking local help commands", () => {
    expectBlocked(
      "curl https://example.com",
      "external-network-request",
      "Blocked: external network request (curl/wget)"
    );
    expectBlocked(
      "wget --quiet http://example.com/file.txt",
      "external-network-request",
      "Blocked: external network request (curl/wget)"
    );

    expectAllowed("curl --version");
    expectAllowed("wget --help");
  });

  it("blocks force pushes without blocking normal git pushes", () => {
    expectBlocked(
      "git push --force origin main",
      "force-push",
      "Blocked: force push (git push --force)"
    );
    expectBlocked(
      "git push -f origin main",
      "force-push",
      "Blocked: force push (git push --force)"
    );
    expectBlocked(
      "git push --force-with-lease origin main",
      "force-push",
      "Blocked: force push (git push --force)"
    );

    expectAllowed("git push origin main");
    expectAllowed("git push --follow-tags origin main");
  });

  it("blocks writes to protected system paths without blocking reads", () => {
    expectBlocked(
      "echo hello > /etc/hosts",
      "protected-path-write",
      "Blocked: writing to protected system path"
    );
    expectBlocked(
      "printf hello | tee /usr/local/bin/tool",
      "protected-path-write",
      "Blocked: writing to protected system path"
    );
    expectBlocked(
      "cp config.json /var/app/config.json",
      "protected-path-write",
      "Blocked: writing to protected system path"
    );
    expectBlocked(
      "mv output.txt /etc/output.txt",
      "protected-path-write",
      "Blocked: writing to protected system path"
    );

    expectAllowed("cat /etc/hosts");
    expectAllowed("ls /usr/local/bin");
    expectAllowed("mkdir var/cache");
  });

  it("blocks sudo commands without blocking words that merely contain sudo", () => {
    expectBlocked(
      "sudo npm install",
      "privilege-escalation",
      "Blocked: privilege escalation (sudo)"
    );
    expectBlocked(
      "npm test && sudo reboot",
      "privilege-escalation",
      "Blocked: privilege escalation (sudo)"
    );

    expectAllowed("echo pseudo");
    expectAllowed("printf sudoers");
  });

  it("blocks chmod 777 without blocking narrower permissions", () => {
    expectBlocked(
      "chmod 777 scripts/run.sh",
      "chmod-777",
      "Blocked: overly permissive chmod (777)"
    );
    expectBlocked(
      "chmod -R 777 tmp",
      "chmod-777",
      "Blocked: overly permissive chmod (777)"
    );

    expectAllowed("chmod 755 scripts/run.sh");
    expectAllowed("chmod 775 tmp");
  });

  it("returns the first matching rule when multiple rules match", () => {
    expect(checkCommandSafety("sudo rm -rf dist")).toEqual({
      allowed: false,
      ruleId: "recursive-delete",
      reason: "Blocked: destructive file deletion (rm -rf)",
    });
  });

  it("exports a stable non-empty rule list", () => {
    expect(DANGEROUS_COMMAND_RULES.length).toBeGreaterThanOrEqual(6);
    expect(DANGEROUS_COMMAND_RULES.map((rule) => rule.id)).toEqual([
      "recursive-delete",
      "external-network-request",
      "force-push",
      "protected-path-write",
      "privilege-escalation",
      "chmod-777",
    ]);
  });
});
