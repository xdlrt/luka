# AGENTS.md

## Project Overview

A minimal coding agent built from scratch in TypeScript, modeled after Claude Code's core architecture. The agent implements an agentic loop: collect context, take action via tools, verify results, and repeat until the task is done.

**Current state**: Early initialization (scaffold only). `src/index.ts` is a stub. The planned architecture spans 6 modules:

1. **Agent Loop** — Main while-loop: build messages, call LLM, execute tools, feed results back, stop when model has no more tool calls.
2. **Tool Layer** — read_file, write_file, edit_file, run_command, grep, glob, todo_write with JSON Schema definitions and a ToolRegistry dispatcher.
3. **Context & History** — System prompt assembly, message history management, LLM-based compression when token count exceeds threshold.
4. **Permissions & Safety Harness** — Tool classification (read/write/command), write-before-confirm, dangerous command blocklist, sandbox boundary enforcement.
5. **Planning / TODO** — TodoWrite-style structured task tracking, task decomposition prompts.
6. **Self-Verification** — Auto-run tests after edits, parse results, retry loop with max attempts.

**Tech stack**: TypeScript (ES Modules), Anthropic SDK (`@anthropic-ai/sdk`), Vitest, Node.js CLI (readline REPL).

## Build & Commands

```bash
# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build

# Watch mode (recompile on change)
npm run dev

# Run tests
npm test          # equivalent to: vitest run
```

- Entry point: `src/index.ts` compiles to `dist/index.js`
- Requires Node.js >= 20.0.0
- Module system: ES Modules (`"type": "module"` in package.json)

## Code Style

### TypeScript Configuration

- **Target**: ES2022
- **Module**: NodeNext (with NodeNext resolution)
- **Strict mode**: Enabled (all strict checks)
- **verbatimModuleSyntax**: Enabled — use `import type` for type-only imports
- **isolatedModules**: Enabled — each file must be independently transpilable
- **Declaration files**: Generated (`declaration: true`)
- **Source maps**: Generated

### Conventions

- ES Modules throughout — use `.js` extension in import paths (TypeScript NodeNext resolution requirement)
- No `any` types allowed in source code
- No unused imports or dead code
- Keep exported functions/classes documented with JSDoc (when implementation matures)
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces/types
- File naming: kebab-case (e.g., `agent-loop.ts`, `read-file.ts`, `tool-registry.ts`)

### Architecture Patterns

- **ToolDefinition interface**: Each tool has `name`, `description`, `parameters` (JSON Schema), `execute` function, and `category` (read/write/command)
- **Harness as single control layer**: Agent loop interacts only with Harness; Harness orchestrates sandbox check, rule check, and permission confirmation internally
- **Tool results fed back as messages**: After tool execution, results become part of the conversation history for the next LLM call
- **Stop condition**: Loop ends when the model responds without requesting any tool calls, or when maxTurns is reached

## Testing

- **Framework**: Vitest 4.x
- **Test location**: `tests/**/*.test.ts`
- **Environment**: Node
- **Config**: `vitest.config.ts`
- **Pass policy**: `passWithNoTests: true` (project is in early scaffold phase)

### Test structure (planned)

```
tests/
├── tools/              # Unit tests per tool
├── permissions/        # Permission/sandbox/rules tests
├── context/            # System prompt, message history, compressor
├── planning/           # Todo manager, decomposer
├── verification/       # Test runner, format results, retry
└── integration/        # End-to-end agent loop scenarios
```

### Running tests

```bash
npm test              # Run all tests once
npx vitest           # Watch mode (interactive)
npx vitest run --reporter=verbose  # Verbose output
```

## Security

- **Sandbox boundary**: All file operations (read/write) restricted to configured `workingDirectory`. Paths are resolved and prefix-checked; `..` traversal and absolute paths outside boundary are rejected.
- **Dangerous command blocklist**: Regex-based rules block `rm -rf`, `curl`/`wget` to external, `git push --force`, `sudo`, writes to system paths (`/etc`, `/usr`, `/var`), `chmod 777`.
- **Write confirmation**: Write/command tools require explicit user confirmation (`y/n`) before execution, unless `--auto-approve` flag is set.
- **API key handling**: Loaded from `ANTHROPIC_API_KEY` environment variable. `.env` and `.env.local` are gitignored. Never commit secrets.
- **Max retries**: Self-verification retry loop capped at 3 attempts to prevent infinite loops.
- **Tool categories**: `read` (no confirmation), `write` (confirmation required), `command` (confirmation required + rule check).

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude access |

### AppConfig (src/config.ts — planned)

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `claude-sonnet-4-20250514` | Claude model to use |
| `maxTurns` | 20 | Maximum agent loop iterations |
| `workingDirectory` | CWD | Sandbox root for file operations |
| `autoApprove` | false | Skip write/command confirmations |
| `testCommand` | — | Command to run for self-verification |

### CLI Flags (planned)

- `--auto-approve` / `-y`: Auto-approve all write/command operations
- Standard input: Interactive readline REPL with `> ` prompt; `.exit` or Ctrl+C to quit
