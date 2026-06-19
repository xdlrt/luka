import { checkCommandSafety } from "./rules.js";

export type CommandClassificationKind =
  | "read"
  | "write"
  | "network"
  | "git-write"
  | "dangerous"
  | "unknown";

export interface CommandClassification {
  kind: CommandClassificationKind;
  reasons: string[];
  segments: string[];
}

const READ_COMMANDS = new Set([
  "cat",
  "find",
  "git:diff",
  "git:log",
  "git:show",
  "git:status",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "sed",
  "tail",
  "wc",
]);

const WRITE_COMMANDS = new Set([
  "cp",
  "install",
  "mkdir",
  "mv",
  "npm:install",
  "pnpm:install",
  "touch",
  "yarn:install",
]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "stash",
  "switch",
  "tag",
]);

const NETWORK_COMMANDS = new Set(["curl", "wget"]);
const UNKNOWN_WRAPPERS = new Set(["bash", "env", "node", "npx", "sh", "xargs", "zsh"]);

const RANK: Record<CommandClassificationKind, number> = {
  read: 1,
  write: 2,
  network: 3,
  "git-write": 4,
  unknown: 5,
  dangerous: 6,
};

export function classifyCommand(command: unknown): CommandClassification {
  const safety = checkCommandSafety(command);
  if (!safety.allowed) {
    return {
      kind: "dangerous",
      reasons: [safety.reason],
      segments: typeof command === "string" ? splitCommand(command) : [],
    };
  }

  if (typeof command !== "string" || command.trim() === "") {
    return { kind: "unknown", reasons: ["command is not a non-empty string"], segments: [] };
  }

  if (/`|\$\(/.test(command)) {
    return {
      kind: "unknown",
      reasons: ["command substitution requires manual review"],
      segments: splitCommand(command),
    };
  }

  const segments = splitCommand(command);
  if (segments.length === 0) {
    return { kind: "unknown", reasons: ["command has no executable segment"], segments };
  }

  const classifications = segments.map(classifySegment);
  const kind = classifications.reduce<CommandClassificationKind>(
    (current, item) => (RANK[item.kind] > RANK[current] ? item.kind : current),
    "read"
  );
  const reasons = unique(classifications.flatMap((item) => item.reasons));

  return { kind, reasons, segments };
}

function splitCommand(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|])\s*/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

function classifySegment(segment: string): Omit<CommandClassification, "segments"> {
  if (/(?:^|\s)(?:>|>>)(?:\s|$)/.test(segment)) {
    return { kind: "write", reasons: ["redirects output to a file"] };
  }

  const tokens = tokenizeSegment(segment);
  const command = tokens[0];
  if (command === undefined) {
    return { kind: "unknown", reasons: ["empty command segment"] };
  }

  if (command === "git") {
    const subcommand = tokens.find((token, index) => index > 0 && !token.startsWith("-"));
    if (subcommand === undefined) {
      return { kind: "unknown", reasons: ["git command without subcommand"] };
    }
    const key = `git:${subcommand}`;
    if (READ_COMMANDS.has(key)) {
      return { kind: "read", reasons: [`git ${subcommand} is read-only`] };
    }
    if (GIT_WRITE_SUBCOMMANDS.has(subcommand)) {
      return { kind: "git-write", reasons: [`git ${subcommand} changes repository state`] };
    }
    return { kind: "unknown", reasons: [`unknown git subcommand: ${subcommand}`] };
  }

  const packageManagerSubcommand = classifyPackageManager(command, tokens);
  if (packageManagerSubcommand !== undefined) return packageManagerSubcommand;

  if (READ_COMMANDS.has(command)) {
    return { kind: "read", reasons: [`${command} is read-only`] };
  }
  if (WRITE_COMMANDS.has(command)) {
    return { kind: "write", reasons: [`${command} may modify files`] };
  }
  if (NETWORK_COMMANDS.has(command)) {
    return { kind: "network", reasons: [`${command} may access the network`] };
  }
  if (UNKNOWN_WRAPPERS.has(command)) {
    return { kind: "unknown", reasons: [`${command} can wrap arbitrary commands`] };
  }

  return { kind: "unknown", reasons: [`unclassified command: ${command}`] };
}

function classifyPackageManager(
  command: string,
  tokens: string[]
): Omit<CommandClassification, "segments"> | undefined {
  if (command !== "npm" && command !== "pnpm" && command !== "yarn") {
    return undefined;
  }

  const subcommand = tokens[1];
  if (subcommand === "install" || subcommand === "add") {
    return { kind: "write", reasons: [`${command} ${subcommand} modifies dependencies`] };
  }
  if (subcommand === "run" && tokens[2] !== undefined) {
    return { kind: "unknown", reasons: [`${command} run ${tokens[2]} executes project scripts`] };
  }
  if (subcommand === "test") {
    return { kind: "unknown", reasons: [`${command} test executes project scripts`] };
  }
  return { kind: "unknown", reasons: [`unclassified ${command} subcommand`] };
}

function tokenizeSegment(segment: string): string[] {
  const matches = segment.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
