# P12: 配置、策略与能力治理

> **里程碑**：Agent 具备统一配置和策略治理框架，能清晰控制模型、工具、权限、hooks、observability 和扩展能力，同时不保存密钥或伪装成企业级策略平台。

## 任务清单

- [ ] **P12-W22-T1**: 定义项目配置文件 schema

  **说明**：新增 `.coding-agent/config.json`，用于保存非敏感项目配置。配置文件支持工具开关、hooks 路径、observability 目录、权限规则路径和扩展工具配置路径。环境变量和 CLI flag 仍具有更高优先级。

  **验收标准**：
  - schema 包含 `schemaVersion` 和明确的配置分区
  - 配置文件不得保存 `ARK_API_KEY`、Authorization、token、password、secret
  - 缺失配置文件静默跳过
  - 非法 JSON、未知字段、非法类型时报错清晰
  - 单元测试覆盖读取、默认值、非法 schema 和敏感字段拒绝

  **关键文件**：`src/settings/project-config.ts`、`tests/settings/project-config.test.ts`

---

- [ ] **P12-W22-T2**: 统一配置优先级

  **说明**：把配置来源统一为 `CLI flag > environment > project config > defaults`。新增字段必须同时覆盖 override、环境变量、项目配置、非法值和默认值测试。

  **验收标准**：
  - 现有 `loadConfig()` 保持必填 `ARK_API_KEY` 和 `ARK_MODEL`
  - 所有新增配置字段有明确优先级
  - blank env 不覆盖项目配置
  - override 值优先于所有来源
  - 单元测试覆盖每种来源和冲突优先级

  **关键文件**：`src/config.ts`、`tests/config.test.ts`

---

- [ ] **P12-W22-T3**: Workspace trust 学习版

  **说明**：新增工作目录 trust 状态。未 trust 的 workspace 默认只允许 read 工具和本地文档读取；写入、命令、外部工具和 hooks 需要明确 trust 或用户单次确认。

  **验收标准**：
  - trust 状态保存到 `.coding-agent/trust.json` 或用户指定路径
  - 未 trust 时 write/command/extensions/hooks 默认受限
  - trust 文件不包含环境变量或密钥
  - CLI/TUI 能显示当前 trust 状态
  - 单元测试覆盖未 trust、已 trust、损坏 trust 文件和权限限制

  **关键文件**：`src/policy/workspace-trust.ts`、`src/permissions/index.ts`、`tests/policy/workspace-trust.test.ts`

---

- [ ] **P12-W22-T4**: 能力开关与策略 gate

  **说明**：新增 capability gate，对工具、hooks、OTel、扩展工具、sub-agent、项目级权限规则做统一启停判断。Gate 的职责是解释“为什么不可用”，不是替代 Harness 安全检查。

  **验收标准**：
  - capability gate 能返回 allowed/blocked 和 reason
  - 被禁用能力不会注册到模型可见工具 schema
  - `--auto-approve` 不能绕过 gate
  - observability 记录能力被禁用的摘要，不记录敏感值
  - 单元测试覆盖工具禁用、hooks 禁用、扩展禁用和 auto-approve 边界

  **关键文件**：`src/policy/capabilities.ts`、`src/tools/index.ts`、`src/session.ts`、`tests/policy/capabilities.test.ts`

---

- [ ] **P12-W22-T5**: 策略诊断命令

  **说明**：新增本地诊断入口，展示当前配置来源、启用能力、权限规则来源、trust 状态和 observability sink。诊断必须脱敏，不展示 API key 或完整环境变量。

  **验收标准**：
  - CLI 支持 `--doctor-config` 或 TUI slash command 后续复用同一 formatter
  - 输出包含配置来源和能力状态
  - 输出中敏感字段全部脱敏
  - 单元测试覆盖脱敏和主要配置分支

  **关键文件**：`src/settings/diagnostics.ts`、`src/index.ts`、`tests/settings/diagnostics.test.ts`

## 验证要求

- 必跑：`npm test -- tests/config.test.ts tests/settings/*.test.ts tests/policy/*.test.ts tests/index.test.ts`
- 修改权限或工具注册时补跑：`npm test -- tests/permissions/*.test.ts tests/tools/registry-integration.test.ts tests/harness.test.ts`
- 合并前跑：`npm run build` 和 `npm test`
