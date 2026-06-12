# Q3 Detailed Execution Plan — Minimal Coding Agent

> **项目**：从零用 TypeScript 手写最小 Coding Agent，对标 Claude Code 核心架构
> **周期**：13 周（W1–W13），每周约 8–10 小时
> **技术栈**：TypeScript (ES Modules), 手写 OpenAI 兼容 HTTP 客户端（火山引擎方舟 / Ark），Vitest, Node.js CLI
> **起始日期**：2026-06-16

---

## 目标项目结构

```
coding-agent/
├── src/
│   ├── index.ts                  # CLI 入口（readline REPL）
│   ├── agent-loop.ts             # 主 Agentic 循环
│   ├── llm-client.ts             # OpenAI 兼容 HTTP 客户端（Ark chat/completions）
│   ├── config.ts                 # 配置管理（API key、模型、限制）
│   ├── types.ts                  # 共享类型定义
│   ├── logger.ts                 # 日志系统
│   ├── harness.ts                # 统一控制层（权限+安全+验证）
│   ├── tools/
│   │   ├── index.ts              # 工具注册表 & 调度器
│   │   ├── types.ts              # ToolDefinition、ToolResult 接口
│   │   ├── read-file.ts
│   │   ├── write-file.ts
│   │   ├── edit-file.ts
│   │   ├── run-command.ts
│   │   ├── grep.ts
│   │   ├── glob.ts
│   │   └── todo-write.ts
│   ├── context/
│   │   ├── system-prompt.ts      # System Prompt 组装
│   │   ├── message-history.ts    # 消息数组管理
│   │   └── compressor.ts         # 历史压缩/摘要
│   ├── permissions/
│   │   ├── index.ts              # 权限检查入口
│   │   ├── categories.ts         # 工具分类（read/write/dangerous）
│   │   ├── rules.ts              # 拦截规则引擎
│   │   └── sandbox.ts            # 工作目录边界
│   ├── planning/
│   │   ├── todo.ts               # TodoWrite 式状态跟踪
│   │   └── decomposer.ts         # 任务拆解提示词
│   └── verification/
│       ├── test-runner.ts        # 自动跑测试
│       ├── format-results.ts     # 测试结果格式化
│       └── retry-loop.ts         # 失败→重试逻辑
├── tests/
│   ├── tools/
│   ├── permissions/
│   ├── context/
│   ├── planning/
│   ├── verification/
│   └── integration/
├── evals/
│   ├── tasks/                    # Eval 任务定义 (JSON)
│   ├── runner.ts                 # Eval 执行器
│   └── results/                  # 结果输出
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── LICENSE
├── CONTRIBUTING.md
└── README.md
```

---

## Phase 1: 通主循环 — Agent Loop + 工具调用最小闭环（W1–W3）

### Week 1 — 项目脚手架 + 首次 LLM 调用

---

- [x] **P1-W1-T1**: 初始化 Node.js 项目（TypeScript + ES Modules）

  **说明**：`npm init`，安装核心依赖（`typescript`、`dotenv`、`vitest`），配置 `tsconfig.json`（`"module": "NodeNext"`、`"moduleResolution": "NodeNext"`），设置 `package.json` scripts（`build`、`dev`、`test`）。LLM 调用走原生 `fetch`，不引入 SDK。

  **验收标准**：
  - `npm run build` 成功编译 `src/index.ts` 到 `dist/`
  - `npm test` 运行 vitest（0 条测试，无报错）
  - `node dist/index.js` 运行不崩溃（可打印 "Hello Agent"）
  - `tsconfig.json` target ES2022+，strict 模式开启

  **关键文件**：`package.json`、`tsconfig.json`、`vitest.config.ts`、`src/index.ts`（存根）

  **预计时间**：1.5h

---

- [x] **P1-W1-T2**: 定义核心类型接口

  **说明**：在 `src/types.ts` 中定义项目中全部模块共用的类型，包括 Message、ToolCall、ToolResult、ChatCompletionRequest/Response 等。对齐 OpenAI 兼容（方舟 Ark）chat/completions 线格式。

  **验收标准**：
  - 定义 `Role`：`'system' | 'user' | 'assistant' | 'tool'`
  - 定义 `Message`：`{ role: Role, content: string | null, tool_calls?: ToolCall[], tool_call_id?: string }`
  - 定义 `ToolCall`：`{ id: string, type: 'function', function: { name: string, arguments: string } }`（arguments 为 JSON 字符串）
  - 定义 `ParsedToolCall`：`{ id: string, name: string, input: Record<string, unknown> }`（解析后的形态）
  - 定义 `ToolResult`：`{ tool_call_id: string, output: string, error?: string }`
  - 定义 `ToolDefinition`：`{ type: 'function', function: { name, description, parameters } }`
  - 定义 `ChatCompletionRequest` / `ChatCompletionResponse` / `Usage` / `FinishReason`
  - 所有类型导出，TypeScript 编译无报错

  **关键文件**：`src/types.ts`

  **预计时间**：1h

---

- [x] **P1-W1-T3**: 实现配置加载模块

  **说明**：创建 `src/config.ts`，从环境变量（`.env` 文件，使用 `dotenv`）加载 API key、模型名称、baseURL，并提供默认值。加入基本校验（API key / model 为空时报错）。**适配 OpenAI 兼容的火山引擎方舟 API**：key 读 `ARK_API_KEY`，model 读 `ARK_MODEL`，baseURL 读 `BASE_URL`（默认 `https://ark.cn-beijing.volces.com/api/v3`）。

  ```typescript
  export interface AppConfig {
    apiKey: string;
    baseURL: string;
    model: string;
    maxTurns: number;
    workingDirectory: string;
  }
  export function loadConfig(overrides?: Partial<AppConfig>): AppConfig;
  ```

  **验收标准**：
  - 从 `ARK_API_KEY` 环境变量读取 API key
  - 从 `ARK_MODEL` 读取模型名（必填，无默认值，因 Anthropic 模型名在方舟不可用）
  - 从 `BASE_URL` 读取，默认 `https://ark.cn-beijing.volces.com/api/v3`；maxTurns 默认 20
  - API key / model 为空时抛出明确错误
  - 优先级：overrides > env > default
  - 单元测试：默认值、环境变量覆盖、缺少 API key、缺少 model、非法 MAX_TURNS、overrides 优先

  **关键文件**：`src/config.ts`、`tests/config.test.ts`

  **预计时间**：1h

---

- [ ] **P1-W1-T4**: 跑通首次 LLM 调用 — 发送消息、收到文本回复

  **说明**：创建 `src/llm-client.ts`，用 `fetch` 向方舟（Ark）的 OpenAI 兼容 `POST {baseURL}/chat/completions` 端点发送单条用户消息，获取文本回复。先用最简单的非流式调用，做一个 `sendMessage` 函数（Authorization: Bearer {apiKey}）。

  **验收标准**：
  - 调用 `POST {baseURL}/chat/completions` 成功，解析 `choices[0].message.content`
  - 收到文本回复并打印到控制台
  - 传入系统提示词 + 用户消息，返回助手文本回复
  - 错误处理：非 2xx 响应 / API key 无效时给出可读的报错信息
  - 手动运行脚本验证：`node dist/index.js "What is 2+2?"` 返回 "4"

  **关键文件**：`src/llm-client.ts`

  **预计时间**：2h

---

- [x] **P1-W1-T5**: 实现 tool_calls 请求解析 — 让模型决定"要不要调工具"

  **说明**：在 LLM 调用中注册工具定义（先只注册一个空工具做测试），让模型在响应中返回 `tool_calls`。解析响应 `choices[0].message.tool_calls` 数组，区分纯文本回复和工具调用，并将每个工具调用的 `function.arguments`（JSON 字符串）解析为 `ParsedToolCall`。

  **验收标准**：
  - 定义一个测试工具（如 `echo`，接收 message 参数，返回 message）
  - 发送"请调用 echo 工具回复 hello"，响应 `finish_reason` 为 `tool_calls` 且包含 `tool_calls`
  - 正确解析出 tool name 和 input（`JSON.parse(function.arguments)`）
  - 日志打印：`[LLM] Model requested tool: echo({ message: "hello" })`

  **关键文件**：`src/llm-client.ts`（修改）、`src/types.ts`（修改）

  **预计时间**：1.5h

---

### Week 2 — 工具层实现

---

- [x] **P1-W2-T1**: 实现工具注册表与调度器

  **说明**：创建 `src/tools/index.ts`，定义工具注册、查找、执行的中心化接口。用 Map 维护工具名→ToolDefinition 的映射。

  ```typescript
  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    execute(input: Record<string, unknown>): Promise<ToolResult>;
    category?: 'read' | 'write' | 'command'; // 预留，W4 才用
  }
  export class ToolRegistry {
    register(tool: ToolDefinition): void;
    get(name: string): ToolDefinition | undefined;
    getAll(): ToolDefinition[];
    async execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
    getToolDefinitions(): ToolDefinition[];
  }
  ```

  **验收标准**：
  - 注册/获取/列出工具
  - `execute` 调用工具的实际实现
  - `getToolDefinitions()` 输出符合 OpenAI 兼容 API 格式的工具定义数组（`{ type: 'function', function: { name, description, parameters } }`）
  - 未注册工具时报错
  - 单元测试：注册、重复注册报错、执行、列工具

  **关键文件**：`src/tools/index.ts`、`src/tools/types.ts`、`tests/tools/index.test.ts`

  **预计时间**：1.5h

---

- [x] **P1-W2-T2**: 实现 `read_file` 工具

  **说明**：创建 `src/tools/read-file.ts`。参数 `path`（string，必填）。读取文件内容并返回。用 `fs/promises.readFile`，utf-8 编码。

  **验收标准**：
  - 读取存在的文件，返回内容
  - 文件不存在时返回错误（不崩溃）
  - 路径在工作目录之外时拒绝（简单校验：路径不能以 `/` 开头且不能包含 `..`—初期用简单规则）
  - 单元测试：正常读取、文件不存在、空文件、二进制文件（应报错）

  **关键文件**：`src/tools/read-file.ts`、`tests/tools/read-file.test.ts`

  **预计时间**：1.5h

---

- [x] **P1-W2-T3**: 实现 `write_file` 工具

  **说明**：创建 `src/tools/write-file.ts`。参数 `path`（string）、`content`（string），均为必填。写入文件内容，如果目录不存在则自动创建。

  **验收标准**：
  - 写入新文件成功
  - 覆盖已有文件成功
  - 自动创建中间目录
  - 路径在工作目录外时拒绝
  - 单元测试：创建新文件、覆盖已有、嵌套路径、边界路径

  **关键文件**：`src/tools/write-file.ts`、`tests/tools/write-file.test.ts`

  **预计时间**：1.5h

---

- [x] **P1-W2-T4**: 实现 `run_command` 工具

  **说明**：创建 `src/tools/run-command.ts`。参数 `command`（string，必填）。用 `child_process.exec` 执行命令，超时 30s，返回 stdout + stderr + exit code。初期不做权限拦截（W5 加入）。

  **验收标准**：
  - 执行简单命令（如 `echo hello`），返回 stdout
  - 命令失败时返回 stderr 和 exit code（不抛异常）
  - 超时 30s 后杀掉进程
  - 单元测试：成功命令、失败命令、超时命令（如 `sleep 35`）

  **关键文件**：`src/tools/run-command.ts`、`tests/tools/run-command.test.ts`

  **预计时间**：2h

---

- [x] **P1-W2-T5**: 将所有工具注册到 ToolRegistry 并写集成测试

  **说明**：在 `src/index.ts`（或初始化脚本）中将 read_file、write_file、run_command 注册到 ToolRegistry。写一条集成测试：让模型调用所有工具并验证结果。

  **验收标准**：
  - 三个工具全部注册
  - 集成测试：模拟 tool_calls 响应，让 registry 执行 read/write/run 并验证结果
  - 模型能在一次对话中选择并调用多个工具
  - `npm test` 全部通过

  **关键文件**：`src/tools/index.ts`（修改）、`tests/tools/registry-integration.test.ts`

  **预计时间**：1.5h

---

### Week 3 — 闭合主循环

---

- [x] **P1-W3-T1**: 实现 Agent Loop 主循环

  **说明**：创建 `src/agent-loop.ts`。实现 while 循环：构建消息（系统提示词 + 工具定义 + 用户输入）→ 调用 LLM → 如有 tool_calls 则执行 → 结果回喂 → 继续循环 → 模型不调工具时停止。

  ```typescript
  export interface AgentResult {
    finalMessage: string;
    turnsUsed: number;
    toolsCalled: string[];
    success: boolean;
  }
  export async function runAgentLoop(
    userInput: string,
    config: AppConfig,
    tools: ToolRegistry,
  ): Promise<AgentResult>;
  ```

  **验收标准**：
  - 模型可以零工具调用直接回答
  - 模型调用工具 → 工具执行 → 结果回喂 → 模型再次决策
  - 多轮工具调用正常工作（如先 read 再 write）
  - 达到 `maxTurns` 时强制停止并返回目前结果
  - 单元测试（mock LLM）：验证循环控制流

  **关键文件**：`src/agent-loop.ts`、`tests/agent-loop.test.ts`

  **预计时间**：3h

---

- [x] **P1-W3-T2**: 实现 System Prompt 基线

  **说明**：创建 `src/context/system-prompt.ts`。组装系统提示词：角色定义、工具使用说明、行为约束。初版提示词简洁，控制在 800 词以内。

  **验收标准**：
  - 包含角色说明："你是一个 Coding Agent，帮助用户编写和修改代码"
  - 包含工具使用规则："优先使用工具获取信息，不要凭空猜测文件内容"
  - 包含安全规则（初版）："不要执行破坏性操作"
  - 提示词为常量字符串，后续可函数化
  - 单元测试：验证提示词不为空、不超长

  **关键文件**：`src/context/system-prompt.ts`、`tests/context/system-prompt.test.ts`

  **预计时间**：1h

---

- [x] **P1-W3-T3**: 实现 CLI 入口 — readline REPL

  **说明**：修改 `src/index.ts`，用 Node.js `readline` 模块实现交互式 REPL。用户可以逐行输入需求，Agent 执行并输出结果。支持 `.exit` 退出。

  **验收标准**：
  - 启动后显示提示符 `> `
  - 输入普通文字 → 传给 Agent → 输出结果 → 回到提示符
  - 显示 Agent 执行进度（调用了哪些工具）
  - 输入 `.exit` 或 Ctrl+C 退出
  - 错误不导致崩溃，回到提示符

  **关键文件**：`src/index.ts`

  **预计时间**：2h

---

- [x] **P1-W3-T4**: 端到端 demo — Agent 自己读写文件改代码

  **说明**：第一个完整的集成测试。用临时目录创建一个小项目，给 Agent 一个简单需求（如"在 src/greet.ts 中创建一个函数 greet(name) 返回 Hello, name!"），Agent 需要自己写文件、读文件验证。

  **验收标准**：
  - Agent 用 write_file 创建 `greet.ts`
  - Agent 用 read_file 验证内容
  - 没有手动干预，完全自动化
  - Agent 在 3 轮以内完成任务
  - **P1 里程碑达成**：能跑通"给需求→Agent 自己读写改代码"的闭环

  **关键文件**：`tests/integration/p1-end-to-end.test.ts`、`src/agent-loop.ts`（可能修改）

  **预计时间**：2h

---

## Phase 2: 立 Harness — 权限安全 + 自验证回路（W4–W8）

### Week 4 — 权限内核

---

- [ ] **P2-W4-T1**: 实现工具分类系统

  **说明**：创建 `src/permissions/categories.ts`。将工具分为三类：`read`（read_file）、`write`（write_file、edit_file）、`command`（run_command）。为 ToolDefinition 添加 `category` 字段。

  **验收标准**：
  - `classifyTool(toolName: string): ToolCategory` 返回正确分类
  - 所有已注册工具都有分类
  - 未注册工具返回 `unknown`
  - 单元测试：所有工具分类正确

  **关键文件**：`src/permissions/categories.ts`、`tests/permissions/categories.test.ts`

  **预计时间**：1h

---

- [ ] **P2-W4-T2**: 实现 write_file 和 run_command 的写前确认机制

  **说明**：创建 `src/permissions/index.ts`。在执行 write 或 command 类工具之前，打印将要执行的操作（文件路径/命令内容），要求用户在终端输入 `y` 确认或 `n` 拒绝。

  **验收标准**：
  - 执行 write_file 前打印：`[PERMISSION] Write file: {path}\nContent preview: {前3行}...\nProceed? (y/n)`
  - 输入 `y` → 执行工具
  - 输入 `n` → 跳过工具，返回 "Cancelled by user"
  - read 类工具跳过确认
  - 单元测试：mock stdin 测试 y/n 分支

  **关键文件**：`src/permissions/index.ts`、`tests/permissions/index.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W4-T3**: 将权限确认接入 Agent Loop

  **说明**：修改 `src/agent-loop.ts`，在工具执行前插入权限检查。Agent Loop 不直接了解权限细节，通过一个 `permissionCheck(tool, input)` 函数完成。

  **验收标准**：
  - read_file 不触发确认直接执行
  - write_file 触发确认，y 执行 / n 跳过
  - run_command 触发确认
  - Agent Loop 中权限被拒后，模型能感知并继续（不卡死）
  - 已有集成测试不受影响

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-permission.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W4-T4**: 增加命令行 Flag：`--auto-approve` 模式

  **说明**：在 CLI 中添加 `--auto-approve` / `-y` 参数。此模式下写操作和命令执行自动通过，不需要交互确认。用于自动化测试和集成测试场景。

  **验收标准**：
  - `node dist/index.js --auto-approve` 启动后所有操作自动通过
  - 不加该参数则正常需要确认
  - 集成测试使用 `--auto-approve` 模式

  **关键文件**：`src/index.ts`（修改）、`src/config.ts`（添加 autoApprove 字段）

  **预计时间**：2h

---

### Week 5 — 安全拦截

---

- [ ] **P2-W5-T1**: 实现危险命令拦截规则引擎

  **说明**：创建 `src/permissions/rules.ts`。维护一个危险命令规则列表，在执行 `run_command` 前检查命令是否为已知危险模式。用正则表达式匹配，支持黑名单和参数拦截。

  **验收标准**：
  - 拦截规则至少覆盖：
    - `rm -rf` / `rm -r` 任何递归删除
    - `curl` / `wget` 向外部发送请求
    - `git push --force` / `git push -f`
    - 写入 `/etc`、`/usr`、`/var` 等系统路径
    - `sudo` 提权命令
    - `chmod 777` 过度开放权限
  - 匹配的命令直接拒绝，不进入确认环节
  - 拒绝时给出明确理由："Blocked: destructive file deletion (rm -rf)"
  - 单元测试：每种规则的正向和反向测试（应拦截 + 不应拦截）

  **关键文件**：`src/permissions/rules.ts`、`tests/permissions/rules.test.ts`

  **预计时间**：2.5h

---

- [ ] **P2-W5-T2**: 实现沙箱边界 — 工作目录限制

  **说明**：创建 `src/permissions/sandbox.ts`。所有文件操作（read、write）和命令执行都限制在配置的 `workingDirectory` 内。对路径做规范化和前缀检查。

  **验收标准**：
  - 文件路径必须在 `workingDirectory` 内（经过 `resolve` 后检查）
  - 路径包含 `..` 时展开后重新检查（防止越狱）
  - 绝对路径（如 `/etc/passwd`）被拒绝
  - 符号链接不追踪（简单实现即可）
  - 单元测试：合法路径、`..` 越狱、绝对路径、符号链接边界

  **关键文件**：`src/permissions/sandbox.ts`、`tests/permissions/sandbox.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W5-T3**: 将安全拦截接入工具执行链路

  **说明**：修改工具执行流程：在执行任何工具前 → 先过沙箱检查 → 再过规则检查 → 再过权限确认。三个检查串联，任一步失败则拒绝执行。

  **验收标准**：
  - `read_file("../../etc/passwd")` → 沙箱拦截
  - `run_command("rm -rf /tmp/test")` → 规则拦截
  - `write_file("test.txt", "hello")` → 确认提示（非 auto-approve 模式）
  - 拦截时模型能拿到拒绝原因
  - 全方位集成测试：模拟各种危险操作，验证均被挡住

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/permissions/integration.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W5-T4**: 实现 `edit_file` 工具（基于 patch/diff）

  **说明**：创建 `src/tools/edit-file.ts`。参数 `path`、`old_string`、`new_string`。与 write_file 不同，edit_file 做精确替换而非全量覆盖，更安全（减少意外覆盖风险）。先做简单的字符串替换，不生成 diff。

  **验收标准**：
  - 找到 `old_string` 在文件中的位置，替换为 `new_string`
  - `old_string` 不存在时返回错误（不创建新文件）
  - `old_string` 出现多次时报错，要求提供更长的上下文
  - 归类为 `write` 类别，遵循相同的权限和安全检查
  - 单元测试：替换成功、字符串不存在、多处匹配、空文件

  **关键文件**：`src/tools/edit-file.ts`、`tests/tools/edit-file.test.ts`

  **预计时间**：1.5h

---

### Week 6 — 自验证回路（上）：自动跑测试

---

- [ ] **P2-W6-T1**: 实现测试执行器

  **说明**：创建 `src/verification/test-runner.ts`。Agent 完成编辑后自动执行指定的测试命令。本质上是对 `run_command` 的封装，但增加了测试专用逻辑：记录 exit code、解析输出、判断 pass/fail。

  ```typescript
  export interface TestResult {
    passed: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }
  export async function runTests(command: string, cwd: string): Promise<TestResult>;
  ```

  **验收标准**：
  - 执行测试命令并捕获输出
  - exitCode 0 = passed，非 0 = failed
  - 记录执行时长
  - 超时 60 秒
  - 单元测试：模拟 `vitest run` 成功/失败/超时

  **关键文件**：`src/verification/test-runner.ts`、`tests/verification/test-runner.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W6-T2**: 实现测试结果格式化器

  **说明**：创建 `src/verification/format-results.ts`。将原始 `TestResult` 转换成适合回喂给模型的简洁摘要。提取关键信息：失败数、通过数、失败文件的路径和具体报错。

  **验收标准**：
  - 成功时输出：`All tests passed (5 tests in 3 files, 1.2s)`
  - 失败时输出：`Tests failed: 2 of 5\nFAIL src/add.test.ts > add > should add correctly\n  Expected: 5\n  Received: 4`
  - 截断过长输出（超过 2000 字符时加 "...truncated"）
  - 单元测试：解析 vitest 成功输出、失败输出、空输出

  **关键文件**：`src/verification/format-results.ts`、`tests/verification/format-results.test.ts`

  **预计时间**：1.5h

---

- [ ] **P2-W6-T3**: 将测试验证接入 Agent Loop 的编辑后阶段

  **说明**：修改 Agent Loop，在工具执行之后检查——如果执行了 `write_file` 或 `edit_file`，且配置了 `testCommand`，则自动运行测试并采集结果。结果以 assistant 消息的形式注入对话。

  **验收标准**：
  - 编辑后自动触发 `runTests(config.testCommand, config.workingDirectory)`
  - 结果被注入为 assistant role 的系统消息
  - 模型能看到测试结果
  - 如果配置中没有 `testCommand`，则跳过验证
  - 单元测试：验证编辑触发测试的时序

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-verification.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W6-T4**: 端到端测试：Agent 改代码后自动跑测试

  **说明**：集成测试：用临时项目（`src/add.ts` 有 bug 的函数 + `tests/add.test.ts`），Agent 编辑代码修复 bug，测试自动运行并看到结果。

  **验收标准**：
  - 创建临时项目：`src/add.ts`（return a + b 写错了）、`tests/add.test.ts`
  - Agent 编辑 `add.ts` 修复 bug
  - 编辑后测试自动运行
  - 测试结果显示在 Agent 的消息历史中

  **关键文件**：`tests/integration/verification-e2e.test.ts`

  **预计时间**：2h

---

### Week 7 — 自验证回路（下）：重试逻辑

---

- [ ] **P2-W7-T1**: 实现重试循环

  **说明**：创建 `src/verification/retry-loop.ts`。包裹 Agent Loop，添加重试语义：如果测试失败，把报错喂回模型让它修复，跟踪重试次数，达到 `maxRetries`（默认 3）后放弃。

  ```typescript
  export interface RetryConfig {
    maxRetries: number;
    testCommand: string;
  }
  export interface RetryResult {
    success: boolean;
    attempts: number;
    finalTestResult: TestResult;
    history: Array<{ attempt: number; testResult: TestResult; modelAction: string }>;
  }
  ```

  **验收标准**：
  - 测试失败后自动注入错误消息："Tests failed. Please fix the issues: {failures}"
  - 模型再获得一次编辑机会
  - 修复后重新跑测试
  - 测试通过或达到 maxRetries 时停止循环
  - 返回完整的重试历史
  - 单元测试（mock LLM）：验证失败→修复→通过流程

  **关键文件**：`src/verification/retry-loop.ts`、`tests/verification/retry-loop.test.ts`

  **预计时间**：3h

---

- [ ] **P2-W7-T2**: 将重试循环接入主 Agent Loop

  **说明**：修改 `src/agent-loop.ts`，当验证启用时，使用重试循环包装编辑-测试流程。外层循环 = 对话轮次，内层循环 = "本次编辑的测试是否通过"。

  **验收标准**：
  - 启用验证时：每次编辑→自动跑测试→失败则重试
  - 重试计数只在每次编辑后重置（跨不同编辑操作不累计）
  - 达到最大重试次数后输出："Unable to fix after {n} attempts"，继续对话
  - 关闭验证时：行为不变
  - 单元测试：验证重试计数在不同编辑序列间正确重置

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-retry.test.ts`

  **预计时间**：2h

---

- [ ] **P2-W7-T3**: 实现日志系统

  **说明**：创建 `src/logger.ts`，实现分级日志（debug、info、warn、error）。集成到 Agent Loop：记录每轮编号、工具调用、测试结果、重试信息。由 `--verbose` / `-v` CLI 参数控制。

  **验收标准**：
  - 默认：只显示 info 级别（工具调用、最终回复）
  - Verbose：显示完整 API 请求/响应大小、耗时、重试决策
  - 日志格式：`[TURN 3] [Tool: edit_file] path=src/add.ts`
  - `[VERIFY] Tests failed (attempt 2/3): 1 failure`
  - Logger 支持依赖注入（测试时不捕获 stdout）

  **关键文件**：`src/logger.ts`、`src/index.ts`（修改）、`tests/logger.test.ts`

  **预计时间**：1.5h

---

- [ ] **P2-W7-T4**: 完整的自修复集成测试

  **说明**：P2 的核心里程碑测试。用真实的小项目：TypeScript 文件中有 bug、对应测试失败。Agent 需要：读测试→读实现→修改→验证通过。

  **验收标准**：
  - 临时项目：`src/utils.ts`（`reverseString` 有 bug）、`tests/utils.test.ts`
  - Agent 读文件、识别 bug、做出修改
  - 测试自动运行，首次或二次尝试通过
  - 如首次失败，错误回喂给模型重试
  - 断言：最终 `TestResult.passed === true` 且 `attempts <= 3`
  - **P2 核心里程碑 demo**

  **关键文件**：`tests/integration/self-fix-e2e.test.ts`

  **预计时间**：2h

---

### Week 8 — Harness 整合 + Eval 基线

---

- [ ] **P2-W8-T1**: 统一权限 + 规则 + 沙箱 + 验证为 Harness 类

  **说明**：创建 `src/harness.ts` 作为唯一的控制层。Agent Loop 只与 Harness 交互，不直接感知各子模块。

  ```typescript
  export class Harness {
    constructor(config: HarnessConfig);
    async preExecute(toolName: string, input: Record<string, unknown>): Promise<HarnessDecision>;
    async postExecute(toolName: string, result: ToolResult): Promise<PostExecuteAction>;
  }
  export type HarnessDecision = { proceed: true } | { proceed: false; reason: string };
  export type PostExecuteAction = { runVerification: boolean };
  ```

  **验收标准**：
  - `preExecute` 串联：沙箱检查 → 规则检查 → 权限确认
  - `postExecute` 判断是否需要触发验证
  - Agent Loop 只调用 Harness 方法
  - 重构后所有已有测试继续通过
  - 新增：Harness 集成测试覆盖完整 pipeline

  **关键文件**：`src/harness.ts`、`src/agent-loop.ts`（修改）、`tests/harness.test.ts`

  **预计时间**：2.5h

---

- [ ] **P2-W8-T2**: 设计 eval 任务格式并创建 5 个基准任务

  **说明**：创建 `evals/` 目录。定义 eval 任务格式（JSON）：任务描述、初始项目状态（文件列表）、预期结果。创建 5 个难度递进的小任务。

  ```typescript
  export interface EvalTask {
    id: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    setup: { files: Record<string, string> };
    expectations: {
      filesModified?: string[];
      testsPassing?: boolean;
      outputContains?: string[];
    };
  }
  ```

  **验收标准**：
  - Task 01 (easy)：创建文件
  - Task 02 (easy)：修复拼写错误
  - Task 03 (medium)：修复逻辑 bug
  - Task 04 (medium)：添加函数
  - Task 05 (medium)：带测试重构
  - 每个任务有明确的 setup 文件和可验证的期望

  **关键文件**：`evals/tasks/types.ts`、`evals/tasks/01-create-file.json` 至 `05-refactor.json`

  **预计时间**：2h

---

- [ ] **P2-W8-T3**: 构建 eval 执行器

  **说明**：创建 `evals/runner.ts`：(1) 读取任务 JSON，(2) 创建临时目录和文件，(3) 用 auto-approve 模式运行 Agent，(4) 检查期望，(5) 记录结果（pass/fail、轮数、重试次数、耗时）。

  **验收标准**：
  - 单任务运行：`npx tsx evals/runner.ts --task 01-create-file`
  - 全量运行：`npx tsx evals/runner.ts --all`
  - 结果输出 JSON 到 `evals/results/{timestamp}.json`
  - 记录：task_id、passed、turns_used、retries、wall_time_ms
  - 每个任务后清理临时目录

  **关键文件**：`evals/runner.ts`、`evals/results/.gitkeep`

  **预计时间**：2.5h

---

- [ ] **P2-W8-T4**: 运行 eval、记录基线、更新 README

  **说明**：运行完整 eval 套件，记录结果为 P2 基线。在 README 中添加 "Eval Results" 章节。

  **验收标准**：
  - Eval 全量运行完成（5 个任务）
  - 结果 JSON 保存含时间戳
  - README 更新基准指标表
  - 至少 3/5 任务通过（不通过则调试、记录原因）
  - **P2 里程碑达成**：Agent 具有完整 Harness（确认+拦截+自验证）+ eval 基线数据

  **关键文件**：`evals/results/{date}-baseline.json`、`README.md`（修改）

  **预计时间**：2h

---

## Phase 3: 强能力 — 上下文管理 + 规划/TODO（W9–W11）

### Week 9 — 上下文管理：智能检索

---

- [ ] **P3-W9-T1**: 实现 `grep` 工具

  **说明**：创建 `src/tools/grep.ts`。用正则搜索文件内容。参数：`pattern`（string，必填）、`path`（string，可选）、`include`（string，可选，glob 过滤）。使用 Node `fs` + 正则实现。

  **验收标准**：
  - 递归搜索指定目录（默认工作目录）
  - 返回匹配：文件路径 + 行号 + 匹配行
  - 限制输出前 50 条（附带 truncated 提示）
  - 默认忽略 `node_modules`、`.git`、`dist`
  - 单元测试：单文件搜索、递归搜索、glob 过滤、无匹配

  **关键文件**：`src/tools/grep.ts`、`tests/tools/grep.test.ts`

  **预计时间**：2h

---

- [ ] **P3-W9-T2**: 实现 `glob` 工具

  **说明**：创建 `src/tools/glob.ts`。按 glob 模式查找文件。参数：`pattern`（string，必填）、`path`（string，可选）。返回相对路径的文件列表。使用 `fast-glob` 包。

  **验收标准**：
  - 支持标准 glob：`**/*.ts`、`src/**/*.test.ts`、`*.json`
  - 结果按字母排序
  - 限制前 100 条
  - 默认排除 `node_modules`、`.git`、`dist`
  - 单元测试：TypeScript 文件、嵌套模式、无匹配、限制行为

  **关键文件**：`src/tools/glob.ts`、`tests/tools/glob.test.ts`

  **预计时间**：1.5h

---

- [ ] **P3-W9-T3**: 增强 System Prompt — 添加检索策略指导

  **说明**：更新 `src/context/system-prompt.ts`，添加模型如何使用 grep/glob 的指导。包括："使用 grep 找到相关代码再修改"、"用 glob 了解项目结构"、"阅读具体文件而不要猜测内容"。

  **验收标准**：
  - 系统提示词包含工具使用策略
  - 包含 workflow 提示：glob 定位文件 → grep 找相关代码 → read_file 获取完整上下文 → edit
  - 更新后提示词在 2000 token 以内
  - 手动测试：给 Agent 多文件任务，验证它使用 grep/glob

  **关键文件**：`src/context/system-prompt.ts`（修改）、`tests/context/system-prompt.test.ts`（更新）

  **预计时间**：1.5h

---

- [ ] **P3-W9-T4**: 实现消息历史管理器

  **说明**：创建 `src/context/message-history.ts`。管理对话消息数组，提供：追加消息、估算 token 数、获取上下文总大小、序列化为 API 格式。

  ```typescript
  export class MessageHistory {
    append(message: Message): void;
    getMessages(): Message[];
    getApproxTokenCount(): number;
    getLastN(n: number): Message[];
    clear(): void;
  }
  ```

  **验收标准**：
  - 正确追加和检索消息
  - Token 估算：约 4 字符/token
  - `getLastN` 返回最近 N 条
  - 序列化输出与 OpenAI 兼容（Ark）chat/completions API 兼容
  - 单元测试：追加、检索、token 计数、getLastN

  **关键文件**：`src/context/message-history.ts`、`tests/context/message-history.test.ts`

  **预计时间**：1.5h

---

- [ ] **P3-W9-T5**: 消息历史接入 Agent Loop

  **说明**：重构 `src/agent-loop.ts`，使用 `MessageHistory` 管理消息，替代裸数组操作。

  **验收标准**：
  - Agent Loop 用 MessageHistory 做所有消息操作
  - 行为完全不变（已有测试全部通过）
  - 每轮记录 token 数（verbose 模式可见）
  - AgentResult 中报告总 token 消耗

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop.test.ts`（按需更新）

  **预计时间**：1.5h

---

### Week 10 — 上下文管理：历史压缩

---

- [ ] **P3-W10-T1**: 实现对话压缩器

  **说明**：创建 `src/context/compressor.ts`。当对话 token 数超过阈值时，用一次 LLM 调用将早期消息压缩为摘要，保留关键信息（修改了哪些文件、做了什么决定）。

  ```typescript
  export class ContextCompressor {
    constructor(config: { maxTokens: number; compressionThreshold: number; preserveLastN: number });
    async shouldCompress(history: MessageHistory): boolean;
    async compress(history: MessageHistory): Promise<MessageHistory>;
  }
  ```

  **验收标准**：
  - token 超过 `compressionThreshold`（默认 80000）时触发压缩
  - 保留最后 N 条消息不变（默认 10）
  - 早期消息被摘要为一条 "Context summary" 消息
  - 摘要包含：读取/修改的文件、关键决定、当前任务状态
  - 单元测试：长对话压缩后 token 减少
  - 单元测试：最后 N 条消息未被修改

  **关键文件**：`src/context/compressor.ts`、`tests/context/compressor.test.ts`

  **预计时间**：3h

---

- [ ] **P3-W10-T2**: 压缩器接入 Agent Loop

  **说明**：在每次 LLM 调用前检查是否需要压缩。如需压缩，执行后替换消息历史，再继续调用。

  **验收标准**：
  - 每次循环迭代开始时检查
  - 触发时日志：`[CONTEXT] Compressing: {before_tokens} → {after_tokens} tokens`
  - 压缩后 Agent 行为不受影响
  - 短对话不触发压缩
  - 单元测试：模拟长对话验证压缩触发

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-compression.test.ts`

  **预计时间**：2h

---

- [ ] **P3-W10-T3**: 实现 context-budget 感知的文件读取

  **说明**：修改 `read_file` 工具——对超大文件做截断处理。超过 500 行的文件只返回前 100 + 后 50 行，附带提示："File truncated. Use offset/limit to read specific sections, or grep to find relevant parts."

  **验收标准**：
  - 500 行内：返回完整内容
  - 超过 500 行：返回前 100 + 后 50 行 + 截断提示
  - 提示引导模型使用 offset/limit 或 grep
  - 单元测试：读大文件验证截断和提示

  **关键文件**：`src/tools/read-file.ts`（修改）、`tests/tools/read-file.test.ts`（更新）

  **预计时间**：1.5h

---

- [ ] **P3-W10-T4**: 新增 5 个多文件 eval 任务

  **说明**：创建需要 Agent 在多文件项目中导航的任务，测试检索 + 压缩功能。

  **验收标准**：
  - Task 06：用 grep 找到 bug 并修复（错误信息→定位源码）
  - Task 07：按照已有模式添加新函数（需先读现有代码）
  - Task 08：跨文件重命名函数
  - Task 09：为未测试模块补充测试（需先理解模块）
  - Task 10：根据 spec 文件实现功能
  - 每个任务 3 个以上 setup 文件

  **关键文件**：`evals/tasks/06-grep-fix.json` 至 `10-implement-from-spec.json`

  **预计时间**：2h

---

### Week 11 — 规划与 TODO 机制

---

- [ ] **P3-W11-T1**: 实现 TodoWrite 规划工具

  **说明**：创建 `src/planning/todo.ts`。模型可以调用此工具创建和管理结构化任务列表。每个项有：content、status（pending/in_progress/completed）。

  ```typescript
  export interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }
  export class TodoManager {
    update(todos: TodoItem[]): void;
    getAll(): TodoItem[];
    formatForDisplay(): string;
    formatForModel(): string;
  }
  ```

  **验收标准**：
  - 模型调用 `todo_write` 工具传完整列表（替换当前状态）
  - 每次更新后向用户展示格式化的 TODO 列表
  - TODO 状态注入系统提示词让模型保持感知
  - 同时只能有一个 `in_progress`
  - 单元测试：创建 todo、更新状态、格式化输出

  **关键文件**：`src/planning/todo.ts`、`src/tools/todo-write.ts`、`tests/planning/todo.test.ts`

  **预计时间**：2.5h

---

- [ ] **P3-W11-T2**: System Prompt 添加规划指导

  **说明**：更新系统提示词，指导模型何时和如何使用 todo_write 工具。

  **验收标准**：
  - 提示词说明："3 步以上任务先创建计划"
  - "执行过程中更新 TODO 状态"
  - "验证完成后标记为 completed"
  - 提示词总量控制在 3000 token 以内
  - 手动测试：给多步任务，验证 Agent 先创建计划

  **关键文件**：`src/context/system-prompt.ts`（修改）、`tests/context/system-prompt.test.ts`（更新）

  **预计时间**：1h

---

- [ ] **P3-W11-T3**: 实现任务拆解提示词

  **说明**：创建 `src/planning/decomposer.ts`。当 Agent 收到复杂任务时，构造拆解提示词让模型将任务分解为有序子步骤。

  ```typescript
  export function buildDecompositionPrompt(task: string, projectContext: string): string;
  export function parseDecompositionResponse(response: string): TodoItem[];
  ```

  **验收标准**：
  - 拆解提示词要求模型将任务拆为 3-7 个有序步骤
  - 每步可独立验证
  - 响应解析器从模型文本提取结构化 todo 项
  - 单元测试：解析格式良好的响应
  - 集成测试：拆解"添加带测试的 REST API endpoint"

  **关键文件**：`src/planning/decomposer.ts`、`tests/planning/decomposer.test.ts`

  **预计时间**：2h

---

- [ ] **P3-W11-T4**: CLI 输出中展示规划状态

  **说明**：修改 CLI，每轮 Agent 执行后展示当前 TODO 列表。格式：`[ ] 待办`/`[~] 进行中`/`[x] 已完成` + 进度计数。

  **验收标准**：
  - TODO 列表在每轮后显示（如有）
  - 格式清晰："Progress: 2/5 completed"
  - 无计划时不显示
  - 不干扰对话输出

  **关键文件**：`src/index.ts`（修改）、`src/planning/todo.ts`（修改 formatForDisplay）

  **预计时间**：1.5h

---

- [ ] **P3-W11-T5**: 全量 eval 运行并与 P2 基线对比

  **说明**：运行全部 10 个 eval 任务。与 P2 基线对比。多文件任务（06-10）应受益于 grep/glob 和规划。

  **验收标准**：
  - 10 个任务全部执行
  - 对比表：P2 基线 vs P3 结果（通过率、平均轮数、平均重试）
  - 至少 7/10 通过
  - README 更新新指标
  - **P3 里程碑达成**：Agent 可处理多文件任务并自拆 TODO

  **关键文件**：`evals/results/{date}-p3.json`、`README.md`（更新 eval 章节）

  **预计时间**：2h

---

## Phase 4: 成作品 — 开源打磨 + 技术文章（W12–W13）

### Week 12 — 开源打包

---

- [ ] **P4-W12-T1**: 清理代码 + 添加 JSDoc

  **说明**：审查所有源文件。为所有导出函数/类/接口添加 JSDoc。确保命名一致，无 `any` 类型残留。`tsc --noEmit` 零报错。

  **验收标准**：
  - 所有导出符号有 JSDoc
  - 源码零 `any` 类型
  - 无未使用的 import 和死代码
  - 命名风格统一
  - `tsc --noEmit` 通过

  **关键文件**：所有 `src/**/*.ts`

  **预计时间**：2.5h

---

- [ ] **P4-W12-T2**: 编写完整 README

  **说明**：重写 README：项目概览、Mermaid 架构图、安装/配置说明、使用示例（含终端截图或代码块）、配置参考、eval 结果、设计决策/权衡、contributing、license。

  **验收标准**：
  - 别人 clone 后能在 5 分钟内跑起来
  - 架构图展示 6 个模块及关系
  - 至少 3 个使用示例（简单任务、多文件任务、带验证任务）
  - 配置表文档化所有环境变量和 CLI 参数
  - 设计决策章节解释关键权衡

  **关键文件**：`README.md`

  **预计时间**：2h

---

- [ ] **P4-W12-T3**: 配置 npm 脚本、bin 入口、打包

  **说明**：配置 `package.json`：`"bin"` 字段指向编译后的 CLI、`"files"` 字段限定发布内容、`"engines"` 要求 Node >= 20。入口文件添加 shebang。本地验证 `npx .` 正常运行。

  **验收标准**：
  - `npm link` 后 `coding-agent "修复这个 bug"` 可从任何目录运行
  - `package.json` 中 `bin`、`files`、`engines`、`"type": "module"` 正确
  - 入口文件有 `#!/usr/bin/env node`
  - `npm pack` 产出的 tarball 纯净
  - `.npmignore` / `files` 排除：tests、evals、.env、.git

  **关键文件**：`package.json`（修改）、`src/index.ts`（添加 shebang）、`.npmignore`

  **预计时间**：1.5h

---

- [ ] **P4-W12-T4**: 录制 Demo 并加入 README

  **说明**：用 `asciinema` 录制终端 demo：(1) Agent 修复失败测试、(2) 权限确认提示出现、(3) TODO 列表展示。嵌入 README。

  **验收标准**：
  - 录制约 60 秒的完整任务 demo
  - 清晰展示：工具调用过程、权限提示、测试验证、成功
  - 嵌入 README

  **关键文件**：`README.md`（嵌入 demo）、`docs/demo.cast`

  **预计时间**：1.5h

---

- [ ] **P4-W12-T5**: 添加 LICENSE、CONTRIBUTING.md、GitHub 模板

  **说明**：添加 MIT License。创建最小 CONTRIBUTING.md。添加 GitHub issue/PR 模板。

  **验收标准**：
  - `LICENSE` — MIT 许可证
  - `CONTRIBUTING.md`：开发环境搭建、测试运行、代码风格、PR 流程
  - `.github/ISSUE_TEMPLATE/bug_report.md` 和 `feature_request.md`
  - `.github/pull_request_template.md`

  **关键文件**：`LICENSE`、`CONTRIBUTING.md`、`.github/` 下模板文件

  **预计时间**：1h

---

### Week 13 — 技术文章 + 最终打磨

---

- [ ] **P4-W13-T1**: 撰写技术文章大纲和引言

  **说明**：创建 `docs/article-draft.md`。文章结构：(1) 为什么要从零手写 Coding Agent、(2) Agent Loop 模式解析、(3) 工具调用协议深挖、(4) Harness：让 AI 可控、(5) 自验证回路、(6) 经验教训。写引言（500 字）。

  **验收标准**：
  - 完整大纲，每节有要点
  - 引言有吸引力
  - 每节标注要展示的代码片段
  - 目标篇幅：3000-4000 字

  **关键文件**：`docs/article-draft.md`

  **预计时间**：2h

---

- [ ] **P4-W13-T2**: 撰写文章核心章节（Agent Loop + Harness）

  **说明**：写第 2-4 节：Agent Loop 模式、工具调用协议、Harness 设计。包含真实代码片段。着重解释每个设计决策的"为什么"。

  **验收标准**：
  - Agent Loop 节：解释 while 循环、停止条件、消息格式
  - 工具调用节：展示 JSON Schema 定义、执行、结果格式
  - Harness 节：解释权限模型、安全分层
  - 代码片段来自真实代码库
  - 每节约 600-800 字

  **关键文件**：`docs/article-draft.md`（修改）

  **预计时间**：3h

---

- [ ] **P4-W13-T3**: 撰写文章剩余章节和结论

  **说明**：写第 5-6 节：自验证回路和经验教训。包含 eval 数据。结论 200-300 字，前瞻性。

  **验收标准**：
  - 自验证节：展示重试循环、测试解析、最大尝试次数
  - 经验教训：至少 5 条具体洞察
  - 包含 eval 结果表作为证据
  - 结论有前瞻性
  - 全文 3000-4000 字，通读连贯

  **关键文件**：`docs/article-draft.md`（修改）

  **预计时间**：2h

---

- [ ] **P4-W13-T4**: 最终 eval 运行 + 项目复盘

  **说明**：最后一次全量 eval。与 P2 和 P3 基线对比。在 `docs/retrospective.md` 写复盘：做得好的、比预期难的、下次会不同的、C3/B6/D1 自评更新。

  **验收标准**：
  - 最终 eval 结果已保存
  - 三维对比表：P2 基线 → P3 → 最终
  - 复盘覆盖：时间线遵守情况、技术难点、关键学习
  - 自评更新含具体证据
  - 所有代码已提交、所有测试通过
  - **P4 里程碑达成**：可对外发布的开源项目 + 技术文章完成

  **关键文件**：`evals/results/{date}-final.json`、`docs/retrospective.md`、`README.md`（最终 eval 更新）

  **预计时间**：2h

---

## 工时汇总

| 阶段 | 周次 | 任务数 | 预计工时 |
|------|------|--------|----------|
| P1 | W1 | 5 | 7.0h |
| P1 | W2 | 5 | 8.0h |
| P1 | W3 | 4 | 8.0h |
| P2 | W4 | 4 | 7.0h |
| P2 | W5 | 4 | 8.0h |
| P2 | W6 | 4 | 7.5h |
| P2 | W7 | 4 | 8.5h |
| P2 | W8 | 4 | 9.0h |
| P3 | W9 | 5 | 8.0h |
| P3 | W10 | 4 | 8.5h |
| P3 | W11 | 5 | 9.0h |
| P4 | W12 | 5 | 8.5h |
| P4 | W13 | 4 | 9.0h |
| **合计** | **13 周** | **57 任务** | **~107h** |

---

## 里程碑

- [ ] **P1 里程碑（W3 末）**：CLI Agent 能通过 tool_calls 循环读写文件 — 能自主完成"创建文件并回读验证"
- [ ] **P2 里程碑（W8 末）**：Agent 具备完整 Harness（权限门控 + 安全规则 + 沙箱 + 自验证 + 重试）+ 5 项 eval 基线数据
- [ ] **P3 里程碑（W11 末）**：Agent 能处理多文件项目（grep/glob 检索 + 上下文压缩 + TodoWrite 规划）+ 10 项 eval 数据
- [ ] **P4 里程碑（W13 末）**：可对外发布的开源仓库 + 技术文章完成

---

## 进度日志

> 按日期记录工作进展。格式：`YYYY-MM-DD | 任务ID | 状态 | 备注`

```
<!-- 示例如下：
2026-06-16 | P1-W1-T1 | ✅ 完成 | 项目初始化完成，全部 scripts 正常运行
2026-06-17 | P1-W1-T2 | ✅ 完成 | 类型定义完成，对齐 OpenAI 兼容（Ark）线格式
2026-06-18 | P1-W1-T3 | 🚧 进行中 | 配置加载器实现中
2026-06-20 | P1-W1-T3 | ✅ 完成 | 配置加载器完成，含校验
-->
2026-06-11 | P1-W1-T2 | ✅ 完成 | 手写 OpenAI 兼容线格式类型，对齐 Ark 端点，移除 SDK 依赖
2026-06-11 | P1-W1-T3 | ✅ 完成 | 配置加载器完成，适配方舟 OpenAI 兼容 API（ARK_API_KEY/ARK_MODEL/BASE_URL），6 条单测通过
```

---

## 附录：关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 提供商 | 火山引擎方舟 (Ark, OpenAI 兼容) | 国内可用、OpenAI 兼容 tool_calls，手写 fetch 客户端零 SDK 依赖 |
| 模块系统 | ES Modules (NodeNext) | 现代标准，支持 top-level await |
| 测试框架 | Vitest | 快、ESM 原生、与 TS 兼容 |
| CLI 交互 | Node readline | 零依赖，学习项目够用 |
| 文件操作 | Node fs/promises | 不需要第三方 fs 库 |
| Glob 实现 | `fast-glob` | 维护良好，处理边缘情况 |
| 权限模型 | 分类制 (read/write/dangerous) | 简单、可扩展，对标 Claude Code 方案 |
| 上下文压缩 | LLM 摘要 | 比简单截断更智能 |
| Token 计数 | 近似计数 (chars/4) | 精确 tokenization 复杂度高，收益不成比例 |
| 重试上限 | 3 次 | 在持久性和成本时延间平衡 |

---

## 依赖

```json
{
  "dependencies": {
    "dotenv": "^17.4.2",
    "fast-glob": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.8",
    "@types/node": "^25.9.3"
  }
}
```
