# P10: MCP 与插件式工具扩展

> **里程碑**：Agent 具备学习版外部工具扩展框架，能从本地 manifest 或最小 MCP adapter 注册工具，但所有真实执行仍统一经过 Harness、权限、安全和观测链路。

## 任务清单

- [ ] **P10-W20-T1**: 定义外部工具 manifest

  **说明**：新增本地工具 manifest schema，用 JSON 描述工具名、描述、参数 schema、类别、执行方式和权限类别。manifest 只描述工具能力，不允许内嵌密钥、环境变量 dump 或任意运行时对象。

  **验收标准**：
  - manifest 包含 `schemaVersion`、`tools[]`、`name`、`description`、`parameters`、`category`、`command`
  - `category` 必须映射到现有运行时工具类别
  - 非法 JSON、未知 schema version、缺失字段、重复工具名时显式报错
  - manifest 中出现 `apiKey`、`token`、`secret`、`password` 等敏感字段名时拒绝加载
  - 单元测试覆盖成功加载、非法 schema、重复工具和敏感字段拒绝

  **关键文件**：`src/extensions/manifest.ts`、`tests/extensions/manifest.test.ts`

---

- [ ] **P10-W20-T2**: 实现 manifest 工具 adapter

  **说明**：把 manifest 工具转换为运行时 `ToolDefinition`。执行方式首版只支持在工作目录内运行固定命令模板，并把模型输入作为 JSON stdin 传入；禁止把输入拼进 shell 字符串，避免命令注入。

  **验收标准**：
  - manifest 工具能注册到默认工具集之外的扩展 registry
  - 模型可见 schema 仍只包含 OpenAI-compatible function definition
  - 运行时字段 `execute`、`category`、扩展来源不暴露给模型
  - 执行失败转为工具错误结果，不中断 Agent Loop
  - 单元测试覆盖注册、schema 导出边界、stdin 输入和失败路径

  **关键文件**：`src/extensions/manifest-tool.ts`、`src/tools/index.ts`、`tests/extensions/manifest-tool.test.ts`

---

- [ ] **P10-W20-T3**: CLI 接入扩展工具配置

  **说明**：新增 `--tools-config <path>` 和 `TOOLS_CONFIG`，用于加载本地扩展工具 manifest。CLI flag 必须从用户任务中剥离，禁止传给模型。默认不加载外部工具。

  **验收标准**：
  - `parseCliArgs()` 解析 `--tools-config`
  - `loadConfig()` 支持 `TOOLS_CONFIG`，flag override 优先
  - 未配置时行为不变
  - 配置文件不存在或非法时输出清晰错误
  - 单元测试覆盖 CLI 解析、配置优先级和缺值错误

  **关键文件**：`src/index.ts`、`src/config.ts`、`tests/index.test.ts`、`tests/config.test.ts`

---

- [ ] **P10-W20-T4**: 最小 MCP stdio adapter

  **说明**：实现学习版 MCP stdio client，只支持启动本地 MCP server、读取工具列表、调用工具和关闭进程。首版不做 OAuth、远程 MCP、资源订阅或 elicitation。

  **验收标准**：
  - 能从配置启动本地 stdio server
  - 能把 MCP tools 映射为本地运行时工具
  - MCP 工具调用仍走 Harness 权限和观测事件
  - server 启动失败、协议错误、调用超时都有明确工具错误
  - 单元测试用 fake MCP server 覆盖 list/call/error/timeout

  **关键文件**：`src/extensions/mcp-stdio.ts`、`tests/extensions/mcp-stdio.test.ts`

---

- [ ] **P10-W20-T5**: 扩展工具 eval 任务

  **说明**：新增一个 mock 扩展工具 eval，证明 agent 可以发现并使用扩展工具完成任务。该 eval 不依赖真实外部服务，只验证扩展注册、Harness 执行和 trace 汇总链路。

  **验收标准**：
  - 新增 eval task 使用 manifest 工具完成确定性任务
  - mock eval 不需要外部密钥
  - trace 中能看到扩展工具名和执行结果
  - report 中保留原有 pass/fail、turns、tool calls 指标

  **关键文件**：`evals/tasks/11-extension-tool.json`、`tests/evals-runner.test.ts`

## 验证要求

- 必跑：`npm test -- tests/extensions/*.test.ts tests/tools/registry-integration.test.ts tests/index.test.ts tests/config.test.ts`
- 修改 Harness 或工具执行边界时补跑：`npm test -- tests/harness.test.ts tests/agent-loop.test.ts tests/agent-loop-permission.test.ts`
- 合并前跑：`npm run build`、`npm test` 和 `npm run eval:mock`
