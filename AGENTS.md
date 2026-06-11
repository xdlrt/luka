# AGENTS.md

## 交流语言

与用户交流时，必须使用中文。所有回复、解释、确认信息均使用中文输出。

## 项目概述

一个从零开始用 TypeScript 构建的极简编码代理（coding agent），架构参考 Claude Code 的核心设计。代理实现了一个智能循环：收集上下文、通过工具执行操作、验证结果、循环往复直到任务完成。

**当前状态**：早期初始化阶段（仅有脚手架）。`src/index.ts` 目前是桩代码。规划的架构包含 6 个模块：

1. **Agent Loop（代理循环）** — 主 while 循环：构建消息、调用 LLM、执行工具、将结果回传、当模型不再请求工具调用时停止。
2. **Tool Layer（工具层）** — read_file、write_file、edit_file、run_command、grep、glob、todo_write，带有 JSON Schema 定义和 ToolRegistry 调度器。
3. **Context & History（上下文与历史）** — 系统提示词组装、消息历史管理、token 数超过阈值时基于 LLM 的压缩。
4. **Permissions & Safety Harness（权限与安全护栏）** — 工具分类（read/write/command）、写前确认、危险命令黑名单、沙箱边界强制执行。
5. **Planning / TODO（规划/待办）** — TodoWrite 风格的结构化任务追踪、任务分解提示词。
6. **Self-Verification（自验证）** — 编辑后自动运行测试、解析结果、带最大重试次数的重试循环。

**技术栈**：TypeScript（ES Modules）、Anthropic SDK（`@anthropic-ai/sdk`）、Vitest、Node.js CLI（readline REPL）。

## 构建与命令

```bash
# 安装依赖
npm install

# 编译 TypeScript 到 dist/
npm run build

# 监听模式（文件变化时自动重新编译）
npm run dev

# 运行测试
npm test          # 等同于: vitest run
```

- 入口文件：`src/index.ts` 编译为 `dist/index.js`
- 需要 Node.js >= 20.0.0
- 模块系统：ES Modules（package.json 中 `"type": "module"`）

## 代码风格

### TypeScript 配置

- **Target**：ES2022
- **Module**：NodeNext（使用 NodeNext 解析）
- **严格模式**：开启（所有严格检查）
- **verbatimModuleSyntax**：开启 — 类型导入使用 `import type`
- **isolatedModules**：开启 — 每个文件必须可独立转译
- **声明文件**：生成（`declaration: true`）
- **Source maps**：生成

### 编码约定

- 全部使用 ES Modules — 导入路径使用 `.js` 扩展名（TypeScript NodeNext 解析要求）
- 源代码中禁止使用 `any` 类型
- 禁止未使用的导入或死代码
- 导出的函数/类使用 JSDoc 文档注释（待实现成熟后）
- 命名规范：变量/函数使用 camelCase，类/接口/类型使用 PascalCase
- 文件命名：kebab-case（如 `agent-loop.ts`、`read-file.ts`、`tool-registry.ts`）

### 架构模式

- **ToolDefinition 接口**：每个工具包含 `name`、`description`、`parameters`（JSON Schema）、`execute` 函数和 `category`（read/write/command）
- **Harness 作为唯一控制层**：Agent Loop 仅与 Harness 交互；Harness 内部编排沙箱检查、规则检查和权限确认
- **工具结果作为消息回传**：工具执行后，结果作为对话历史的一部分供下次 LLM 调用使用
- **停止条件**：当模型回复不包含任何工具调用时循环结束，或达到 maxTurns 上限

## 测试

- **框架**：Vitest 4.x
- **测试位置**：`tests/**/*.test.ts`
- **环境**：Node
- **配置文件**：`vitest.config.ts`
- **通过策略**：`passWithNoTests: true`（项目处于早期脚手架阶段）

### 测试目录结构（规划中）

```
tests/
├── tools/              # 每个工具的单元测试
├── permissions/        # 权限/沙箱/规则测试
├── context/            # 系统提示词、消息历史、压缩器
├── planning/           # 待办管理器、任务分解器
├── verification/       # 测试运行器、结果格式化、重试
└── integration/        # 端到端代理循环场景
```

### 运行测试

```bash
npm test              # 运行所有测试（一次）
npx vitest           # 监听模式（交互式）
npx vitest run --reporter=verbose  # 详细输出
```

## 安全性

- **沙箱边界**：所有文件操作（读/写）限制在配置的 `workingDirectory` 内。路径经过解析和前缀检查；`..` 遍历和超出边界的绝对路径会被拒绝。
- **危险命令黑名单**：基于正则的规则阻止 `rm -rf`、`curl`/`wget` 访问外部、`git push --force`、`sudo`、写入系统路径（`/etc`、`/usr`、`/var`）、`chmod 777`。
- **写入确认**：写入/命令类工具执行前需要用户明确确认（`y/n`），除非设置了 `--auto-approve` 标志。
- **API 密钥处理**：从 `ANTHROPIC_API_KEY` 环境变量加载。`.env` 和 `.env.local` 已加入 gitignore。绝不提交密钥。
- **最大重试次数**：自验证重试循环上限为 3 次，防止无限循环。
- **工具分类**：`read`（无需确认）、`write`（需要确认）、`command`（需要确认 + 规则检查）。

## 配置

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | 是 | 用于访问 Claude 的 Anthropic API 密钥 |

### AppConfig（src/config.ts — 规划中）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `model` | `claude-sonnet-4-20250514` | 使用的 Claude 模型 |
| `maxTurns` | 20 | 代理循环最大迭代次数 |
| `workingDirectory` | CWD | 文件操作的沙箱根目录 |
| `autoApprove` | false | 跳过写入/命令操作的确认 |
| `testCommand` | — | 用于自验证的运行命令 |

### CLI 标志（规划中）

- `--auto-approve` / `-y`：自动批准所有写入/命令操作
- 标准输入：交互式 readline REPL，提示符为 `> `；输入 `.exit` 或按 Ctrl+C 退出
