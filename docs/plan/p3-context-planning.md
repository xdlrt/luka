# P3: 强能力 — 上下文管理 + 规划/TODO

> **里程碑**：Agent 能处理多文件项目（grep/glob 检索 + 上下文压缩 + TodoWrite 规划）和扩展 eval 数据。

## 任务清单
- [x] **P3-W9-T1**: 实现 `grep` 工具

  **说明**：创建 `src/tools/grep.ts`。用正则搜索文件内容。参数：`pattern`（string，必填）、`path`（string，可选）、`include`（string，可选，glob 过滤）。使用 Node `fs` + 正则实现。

  **验收标准**：
  - 递归搜索指定目录（默认工作目录）
  - 返回匹配：文件路径 + 行号 + 匹配行
  - 限制输出前 50 条（附带 truncated 提示）
  - 默认忽略 `node_modules`、`.git`、`dist`
  - 单元测试：单文件搜索、递归搜索、glob 过滤、无匹配

  **关键文件**：`src/tools/grep.ts`、`tests/tools/grep.test.ts`

---

- [x] **P3-W9-T2**: 实现 `glob` 工具

  **说明**：创建 `src/tools/glob.ts`。按 glob 模式查找文件。参数：`pattern`（string，必填）、`path`（string，可选）。返回相对路径的文件列表。使用 `fast-glob` 包。

  **验收标准**：
  - 支持标准 glob：`**/*.ts`、`src/**/*.test.ts`、`*.json`
  - 结果按字母排序
  - 限制前 100 条
  - 默认排除 `node_modules`、`.git`、`dist`
  - 单元测试：TypeScript 文件、嵌套模式、无匹配、限制行为

  **关键文件**：`src/tools/glob.ts`、`tests/tools/glob.test.ts`

---

- [x] **P3-W9-T3**: 增强 System Prompt — 添加检索策略指导

  **说明**：更新 `src/context/system-prompt.ts`，添加模型如何使用 grep/glob 的指导。包括："使用 grep 找到相关代码再修改"、"用 glob 了解项目结构"、"阅读具体文件而不要猜测内容"。

  **验收标准**：
  - 系统提示词包含工具使用策略
  - 包含 workflow 提示：glob 定位文件 → grep 找相关代码 → read_file 获取完整上下文 → edit
  - 更新后提示词在 2000 token 以内
  - 手动测试：给 Agent 多文件任务，验证它使用 grep/glob

  **关键文件**：`src/context/system-prompt.ts`（修改）、`tests/context/system-prompt.test.ts`（更新）

---

- [x] **P3-W9-T4**: 实现消息历史管理器

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

---

- [x] **P3-W9-T5**: 消息历史接入 Agent Loop

  **说明**：重构 `src/agent-loop.ts`，使用 `MessageHistory` 管理消息，替代裸数组操作。

  **验收标准**：
  - Agent Loop 用 MessageHistory 做所有消息操作
  - 行为完全不变（已有测试全部通过）
  - 每轮记录 token 数（verbose 模式可见）
  - AgentResult 中报告总 token 消耗

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop.test.ts`（按需更新）

---

- [x] **P3-W10-T1**: 实现对话压缩器

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

---

- [x] **P3-W10-T2**: 压缩器接入 Agent Loop

  **说明**：在每次 LLM 调用前检查是否需要压缩。如需压缩，执行后替换消息历史，再继续调用。

  **验收标准**：
  - 每次循环迭代开始时检查
  - 触发时日志：`[CONTEXT] Compressing: {before_tokens} → {after_tokens} tokens`
  - 压缩后 Agent 行为不受影响
  - 短对话不触发压缩
  - 单元测试：模拟长对话验证压缩触发

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-compression.test.ts`

---

- [ ] **P3-W10-T3**: 实现 context-budget 感知的文件读取

  **说明**：修改 `read_file` 工具——对超大文件做截断处理。超过 500 行的文件只返回前 100 + 后 50 行，附带提示："File truncated. Use offset/limit to read specific sections, or grep to find relevant parts."

  **验收标准**：
  - 500 行内：返回完整内容
  - 超过 500 行：返回前 100 + 后 50 行 + 截断提示
  - 提示引导模型使用 offset/limit 或 grep
  - 单元测试：读大文件验证截断和提示

  **关键文件**：`src/tools/read-file.ts`（修改）、`tests/tools/read-file.test.ts`（更新）

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

---

- [ ] **P3-W11-T4**: CLI 输出中展示规划状态

  **说明**：修改 CLI，每轮 Agent 执行后展示当前 TODO 列表。格式：`[ ] 待办`/`[~] 进行中`/`[x] 已完成` + 进度计数。

  **验收标准**：
  - TODO 列表在每轮后显示（如有）
  - 格式清晰："Progress: 2/5 completed"
  - 无计划时不显示
  - 不干扰对话输出

  **关键文件**：`src/index.ts`（修改）、`src/planning/todo.ts`（修改 formatForDisplay）

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

---
