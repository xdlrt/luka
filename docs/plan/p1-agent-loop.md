# P1: 通主循环 — Agent Loop + 工具调用最小闭环

> **里程碑**：CLI Agent 能通过 tool_calls 循环读写文件，能自主完成“创建文件并回读验证”。

## 任务清单
- [x] **P1-W1-T1**: 初始化 Node.js 项目（TypeScript + ES Modules）

  **说明**：`npm init`，安装核心依赖（`typescript`、`dotenv`、`vitest`），配置 `tsconfig.json`（`"module": "NodeNext"`、`"moduleResolution": "NodeNext"`），设置 `package.json` scripts（`build`、`dev`、`test`）。LLM 调用走原生 `fetch`，不引入 SDK。

  **验收标准**：
  - `npm run build` 成功编译 `src/index.ts` 到 `dist/`
  - `npm test` 运行 vitest（0 条测试，无报错）
  - `node dist/index.js` 运行不崩溃（可打印 "Hello Agent"）
  - `tsconfig.json` target ES2022+，strict 模式开启

  **关键文件**：`package.json`、`tsconfig.json`、`vitest.config.ts`、`src/index.ts`（存根）

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

---

- [x] **P1-W1-T4**: 跑通首次 LLM 调用 — 发送消息、收到文本回复

  **说明**：创建 `src/llm-client.ts`，用 `fetch` 向方舟（Ark）的 OpenAI 兼容 `POST {baseURL}/chat/completions` 端点发送单条用户消息，获取文本回复。先用最简单的非流式调用，做一个 `sendMessage` 函数（Authorization: Bearer {apiKey}）。

  **验收标准**：
  - 调用 `POST {baseURL}/chat/completions` 成功，解析 `choices[0].message.content`
  - 收到文本回复并打印到控制台
  - 传入系统提示词 + 用户消息，返回助手文本回复
  - 错误处理：非 2xx 响应 / API key 无效时给出可读的报错信息
  - 手动运行脚本验证：`node dist/index.js "What is 2+2?"` 返回 "4"

  **关键文件**：`src/llm-client.ts`

---

- [x] **P1-W1-T5**: 实现 tool_calls 请求解析 — 让模型决定"要不要调工具"

  **说明**：在 LLM 调用中注册工具定义（先只注册一个空工具做测试），让模型在响应中返回 `tool_calls`。解析响应 `choices[0].message.tool_calls` 数组，区分纯文本回复和工具调用，并将每个工具调用的 `function.arguments`（JSON 字符串）解析为 `ParsedToolCall`。

  **验收标准**：
  - 定义一个测试工具（如 `echo`，接收 message 参数，返回 message）
  - 发送"请调用 echo 工具回复 hello"，响应 `finish_reason` 为 `tool_calls` 且包含 `tool_calls`
  - 正确解析出 tool name 和 input（`JSON.parse(function.arguments)`）
  - 日志打印：`[LLM] Model requested tool: echo({ message: "hello" })`

  **关键文件**：`src/llm-client.ts`（修改）、`src/types.ts`（修改）

---

- [x] **P1-W2-T1**: 实现工具注册表与调度器

  **说明**：创建 `src/tools/index.ts`，定义工具注册、查找、执行的中心化接口。用 Map 维护工具名→ToolDefinition 的映射。

  ```typescript
  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
    execute(input: Record<string, unknown>): Promise<ToolResult>;
    category?: 'read' | 'write' | 'command'; // 预留给权限阶段使用
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

---

- [x] **P1-W2-T2**: 实现 `read_file` 工具

  **说明**：创建 `src/tools/read-file.ts`。参数 `path`（string，必填）。读取文件内容并返回。用 `fs/promises.readFile`，utf-8 编码。

  **验收标准**：
  - 读取存在的文件，返回内容
  - 文件不存在时返回错误（不崩溃）
  - 路径在工作目录之外时拒绝（简单校验：路径不能以 `/` 开头且不能包含 `..`—初期用简单规则）
  - 单元测试：正常读取、文件不存在、空文件、二进制文件（应报错）

  **关键文件**：`src/tools/read-file.ts`、`tests/tools/read-file.test.ts`

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

---

- [x] **P1-W2-T4**: 实现 `run_command` 工具

  **说明**：创建 `src/tools/run-command.ts`。参数 `command`（string，必填）。用 `child_process.exec` 执行命令，超时 30s，返回 stdout + stderr + exit code。初期不做权限拦截（后续加入）。

  **验收标准**：
  - 执行简单命令（如 `echo hello`），返回 stdout
  - 命令失败时返回 stderr 和 exit code（不抛异常）
  - 超时 30s 后杀掉进程
  - 单元测试：成功命令、失败命令、超时命令（如 `sleep 35`）

  **关键文件**：`src/tools/run-command.ts`、`tests/tools/run-command.test.ts`

---

- [x] **P1-W2-T5**: 将所有工具注册到 ToolRegistry 并写集成测试

  **说明**：在 `src/index.ts`（或初始化脚本）中将 read_file、write_file、run_command 注册到 ToolRegistry。写一条集成测试：让模型调用所有工具并验证结果。

  **验收标准**：
  - 三个工具全部注册
  - 集成测试：模拟 tool_calls 响应，让 registry 执行 read/write/run 并验证结果
  - 模型能在一次对话中选择并调用多个工具
  - `npm test` 全部通过

  **关键文件**：`src/tools/index.ts`（修改）、`tests/tools/registry-integration.test.ts`

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

---

- [x] **P1-W3-T4**: 端到端 demo — Agent 自己读写文件改代码

  **说明**：完整的集成测试。用临时目录创建一个小项目，给 Agent 一个简单需求（如"在 src/greet.ts 中创建一个函数 greet(name) 返回 Hello, name!"），Agent 需要自己写文件、读文件验证。

  **验收标准**：
  - Agent 用 write_file 创建 `greet.ts`
  - Agent 用 read_file 验证内容
  - 没有手动干预，完全自动化
  - Agent 在 3 轮以内完成任务
  - **P1 里程碑达成**：能跑通"给需求→Agent 自己读写改代码"的闭环

  **关键文件**：`tests/integration/p1-end-to-end.test.ts`、`src/agent-loop.ts`（可能修改）

---
