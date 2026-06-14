# P2: 立 Harness — 权限安全 + 自验证回路

> **里程碑**：Agent 具备完整 Harness（权限门控 + 安全规则 + 沙箱 + 自验证 + 重试）和 eval 基线数据。

## 任务清单
- [x] **P2-W4-T1**: 实现工具分类系统

  **说明**：创建 `src/permissions/categories.ts`。将工具分为三类：`read`（read_file）、`write`（write_file、edit_file）、`command`（run_command）。为 ToolDefinition 添加 `category` 字段。

  **验收标准**：
  - `classifyTool(toolName: string): ToolCategory` 返回正确分类
  - 所有已注册工具都有分类
  - 未注册工具返回 `unknown`
  - 单元测试：所有工具分类正确

  **关键文件**：`src/permissions/categories.ts`、`tests/permissions/categories.test.ts`

---

- [x] **P2-W4-T2**: 实现 write_file 和 run_command 的写前确认机制

  **说明**：创建 `src/permissions/index.ts`。在执行 write 或 command 类工具之前，打印将要执行的操作（文件路径/命令内容），要求用户在终端输入 `y` 确认或 `n` 拒绝。

  **验收标准**：
  - 执行 write_file 前打印：`[PERMISSION] Write file: {path}\nContent preview: {前3行}...\nProceed? (y/n)`
  - 输入 `y` → 执行工具
  - 输入 `n` → 跳过工具，返回 "Cancelled by user"
  - read 类工具跳过确认
  - 单元测试：mock stdin 测试 y/n 分支

  **关键文件**：`src/permissions/index.ts`、`tests/permissions/index.test.ts`

---

- [x] **P2-W4-T3**: 将权限确认接入 Agent Loop

  **说明**：修改 `src/agent-loop.ts`，在工具执行前插入权限检查。Agent Loop 不直接了解权限细节，通过一个 `permissionCheck(tool, input)` 函数完成。

  **验收标准**：
  - read_file 不触发确认直接执行
  - write_file 触发确认，y 执行 / n 跳过
  - run_command 触发确认
  - Agent Loop 中权限被拒后，模型能感知并继续（不卡死）
  - 已有集成测试不受影响

  **关键文件**：`src/agent-loop.ts`（修改）、`tests/agent-loop-permission.test.ts`

---

- [x] **P2-W4-T4**: 增加命令行 Flag：`--auto-approve` 模式

  **说明**：在 CLI 中添加 `--auto-approve` / `-y` 参数。此模式下写操作和命令执行自动通过，不需要交互确认。用于自动化测试和集成测试场景。

  **验收标准**：
  - `node dist/index.js --auto-approve` 启动后所有操作自动通过
  - 不加该参数则正常需要确认
  - 集成测试使用 `--auto-approve` 模式

  **关键文件**：`src/index.ts`（修改）、`src/config.ts`（添加 autoApprove 字段）

---

- [x] **P2-W5-T1**: 实现危险命令拦截规则引擎

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

---

- [x] **P2-W5-T2**: 实现沙箱边界 — 工作目录限制

  **说明**：创建 `src/permissions/sandbox.ts`。所有文件操作（read、write）和命令执行都限制在配置的 `workingDirectory` 内。对路径做规范化和前缀检查。

  **验收标准**：
  - 文件路径必须在 `workingDirectory` 内（经过 `resolve` 后检查）
  - 路径包含 `..` 时展开后重新检查（防止越狱）
  - 绝对路径（如 `/etc/passwd`）被拒绝
  - 符号链接不追踪（简单实现即可）
  - 单元测试：合法路径、`..` 越狱、绝对路径、符号链接边界

  **关键文件**：`src/permissions/sandbox.ts`、`tests/permissions/sandbox.test.ts`

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

---

- [x] **P2-W5-T4**: 实现 `edit_file` 工具（基于 patch/diff）

  **说明**：创建 `src/tools/edit-file.ts`。参数 `path`、`old_string`、`new_string`。与 write_file 不同，edit_file 做精确替换而非全量覆盖，更安全（减少意外覆盖风险）。先做简单的字符串替换，不生成 diff。

  **验收标准**：
  - 找到 `old_string` 在文件中的位置，替换为 `new_string`
  - `old_string` 不存在时返回错误（不创建新文件）
  - `old_string` 出现多次时报错，要求提供更长的上下文
  - 归类为 `write` 类别，遵循相同的权限和安全检查
  - 单元测试：替换成功、字符串不存在、多处匹配、空文件

  **关键文件**：`src/tools/edit-file.ts`、`tests/tools/edit-file.test.ts`

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

---

- [ ] **P2-W6-T2**: 实现测试结果格式化器

  **说明**：创建 `src/verification/format-results.ts`。将原始 `TestResult` 转换成适合回喂给模型的简洁摘要。提取关键信息：失败数、通过数、失败文件的路径和具体报错。

  **验收标准**：
  - 成功时输出：`All tests passed (5 tests in 3 files, 1.2s)`
  - 失败时输出：`Tests failed: 2 of 5\nFAIL src/add.test.ts > add > should add correctly\n  Expected: 5\n  Received: 4`
  - 截断过长输出（超过 2000 字符时加 "...truncated"）
  - 单元测试：解析 vitest 成功输出、失败输出、空输出

  **关键文件**：`src/verification/format-results.ts`、`tests/verification/format-results.test.ts`

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

---

- [ ] **P2-W6-T4**: 端到端测试：Agent 改代码后自动跑测试

  **说明**：集成测试：用临时项目（`src/add.ts` 有 bug 的函数 + `tests/add.test.ts`），Agent 编辑代码修复 bug，测试自动运行并看到结果。

  **验收标准**：
  - 创建临时项目：`src/add.ts`（return a + b 写错了）、`tests/add.test.ts`
  - Agent 编辑 `add.ts` 修复 bug
  - 编辑后测试自动运行
  - 测试结果显示在 Agent 的消息历史中

  **关键文件**：`tests/integration/verification-e2e.test.ts`

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

---
