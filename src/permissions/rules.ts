export type CommandRuleDecision =
  | { allowed: true }
  | { allowed: false; reason: string; ruleId: string };

export interface CommandSafetyRule {
  id: string;
  reason: string;
  pattern: RegExp;
}

const INVALID_COMMAND_REASON =
  "Blocked: run_command requires a non-empty string command";

export const DANGEROUS_COMMAND_RULES: readonly CommandSafetyRule[] = [
  {
    id: "recursive-delete",
    reason: "Blocked: destructive file deletion (rm -rf)",
    pattern: /(?:^|[\s;&|()])rm\s+(?:-[^\s;&|()]*[rR][^\s;&|()]*)(?:\s|$)/,
  },
  {
    id: "external-network-request",
    reason: "Blocked: external network request (curl/wget)",
    pattern:
      /(?:^|[\s;&|()])(?:curl|wget)\s+(?:(?:-[^\s;&|()]+|--[^\s;&|()]+)\s+)*https?:\/\//,
  },
  {
    id: "force-push",
    reason: "Blocked: force push (git push --force)",
    pattern:
      /(?:^|[\s;&|()])git\s+push(?:\s+[^\s;&|()]+)*\s+(?:-f|--force(?:-with-lease)?)(?:[=\s]|$)/,
  },
  {
    id: "protected-path-write",
    reason: "Blocked: writing to protected system path",
    pattern:
      /(?:>|>>)\s*\/(?:etc|usr|var)(?:\/|\s|$)|(?:^|[\s;&|()])tee(?:\s+-[^\s;&|()]+)*\s+\/(?:etc|usr|var)(?:\/|\s|$)|(?:^|[\s;&|()])(?:cp|mv|install|mkdir|touch)\b(?:\s+[^\s;&|()]+)*\s+\/(?:etc|usr|var)(?:\/|\s|$)/,
  },
  {
    id: "privilege-escalation",
    reason: "Blocked: privilege escalation (sudo)",
    pattern: /(?:^|[\s;&|()])sudo(?:\s|$)/,
  },
  {
    id: "chmod-777",
    reason: "Blocked: overly permissive chmod (777)",
    pattern: /(?:^|[\s;&|()])chmod\s+(?:-[^\s;&|()]+\s+)*777(?:\s|$)/,
  },
];

export function checkCommandSafety(command: unknown): CommandRuleDecision {
  if (typeof command !== "string" || command.trim() === "") {
    return {
      allowed: false,
      ruleId: "invalid-command",
      reason: INVALID_COMMAND_REASON,
    };
  }

  for (const rule of DANGEROUS_COMMAND_RULES) {
    if (rule.pattern.test(command)) {
      return {
        allowed: false,
        ruleId: rule.id,
        reason: rule.reason,
      };
    }
  }

  return { allowed: true };
}
