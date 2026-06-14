# Contributing

Thanks for taking the time to improve `coding-agent`. This repository is a small TypeScript implementation of a coding-agent loop, so changes should keep the core flow readable, testable, and honest about current capabilities.

## Development Setup

Requirements:

- Node.js >= 20
- npm

Install dependencies:

```bash
npm install
```

Run the main checks before opening a pull request:

```bash
npm run build
npm test
```

Run the mock eval path when touching eval, trace, hooks, or reporting code:

```bash
npm run eval:mock
```

## Configuration

Real model runs require:

```bash
ARK_API_KEY=your_api_key
ARK_MODEL=your_model_id
```

Do not commit `.env`, real credentials, tokens, Authorization headers, or copied environment dumps.

## Code Style

- Keep TypeScript strict and avoid `any`.
- Use `.js` extensions when importing local TypeScript modules from `src`.
- Keep `src/types.ts` limited to the OpenAI-compatible LLM wire protocol.
- Keep `src/tools/types.ts` limited to the runtime tool protocol.
- Do not expose runtime fields such as `execute` or `category` through `ToolRegistry.getToolDefinitions()`.
- Prefer narrow, behavior-preserving changes over broad refactors.

## Safety And Capability Claims

Documentation, prompts, and CLI output must describe only implemented behavior. This project currently has a basic Harness, path checks, permission prompts, command timeout, and simple command rules. It is not a complete OS sandbox, a mature command-security system, a full IDE agent, a plugin marketplace, or a retrieval-augmented system.

When changing permissions, command execution, sandboxing, or verification behavior, add tests for both the rejected path and the allowed path.

## Pull Request Checklist

- Explain the user-visible behavior change and the design reason.
- Add or update tests for the touched behavior.
- Update README or plan checklists when release-facing behavior changes.
- Run `npm run build` and `npm test`.
- If creating a commit in this repository, update `docs/commit-notes.md` in the same commit with `commit`, `time`, `Why`, `What`, and `How`.
