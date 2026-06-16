# P8: 命令安全与权限规则增强

> **里程碑**：`run_command` 从基础黑名单升级为可解释、可测试、可复用的命令权限系统，同时保持 `--auto-approve` 不绕过安全边界。

## 任务清单

- [ ] **P8-W18-T1**: 实现命令语义分类

  **说明**：新增命令分类器，将命令分为 `read`、`write`、`network`、`git-write`、`dangerous`、`unknown`。先支持基础命令、管道、重定向、`&&`、`||`、`;`。无法可靠分类时归为 `unknown`，走人工确认。

  **验收标准**：
  - `ls`、`cat`、`grep`、`rg`、`git status` 归为 `read`
  - `mkdir`、`touch`、`cp`、`mv`、重定向写文件归为 `write`
  - `curl`、`wget` 归为 `network` 或被现有危险规则拒绝
  - `git push`、`git commit`、`git rebase` 归为 `git-write`
  - `sudo`、递归删除、系统目录写入归为 `dangerous` 或直接拦截
  - 复杂无法解析命令归为 `unknown`

  **关键文件**：`src/permissions/command-classifier.ts`、`tests/permissions/command-classifier.test.ts`

---

- [ ] **P8-W18-T2**: 支持 session 级 allow/deny 规则

  **说明**：权限确认支持“允许一次”、“本 session 总是允许”、“拒绝”。Session 级规则只存在内存和当前 session checkpoint 中，不默认写入项目文件。deny 规则优先于 allow。

  **验收标准**：
  - 已允许的安全 prefix 在同一 session 内不重复询问
  - deny 命中时直接拒绝，不进入确认
  - dangerous 命令即使命中 allow 也必须被安全规则拦截
  - `--auto-approve` 不写入 allow 规则
  - 单元测试覆盖 allow、deny、优先级和 auto-approve

  **关键文件**：`src/permissions/rule-store.ts`、`src/permissions/index.ts`、`src/harness.ts`、`tests/permissions/rule-store.test.ts`

---

- [ ] **P8-W18-T3**: 限制可保存的命令 prefix

  **说明**：新增 prefix 建议与校验逻辑。允许保存保守 prefix，例如 `npm run test`、`git status`；禁止保存可扩大成任意执行的 prefix，例如 `sh:*`、`bash:*`、`zsh:*`、`sudo:*`、`env:*`、`xargs:*`。

  **验收标准**：
  - 安全命令能生成合理 prefix
  - 复合命令最多建议有限数量的 prefix
  - 裸 shell、提权、包装执行器不生成可保存规则
  - 非法 prefix 写入规则时显式报错
  - 单元测试覆盖正向建议和危险 prefix 拒绝

  **关键文件**：`src/permissions/command-prefix.ts`、`tests/permissions/command-prefix.test.ts`

---

- [ ] **P8-W18-T4**: 支持项目级权限规则文件

  **说明**：可选读取 `.luka/permissions.json`。项目级规则用于长期保存 allow/deny；非法 schema 必须拒绝加载。首版不自动写入项目规则，写入能力必须由用户在权限提示中明确选择后再实现。

  **验收标准**：
  - 启动时读取项目级规则
  - 缺失规则文件时静默跳过
  - 非法 JSON 或非法 schema 报错清晰
  - 项目 deny 优先于 session allow
  - 规则文件不得包含命令输出、环境变量或敏感字段

  **关键文件**：`src/permissions/project-rules.ts`、`tests/permissions/project-rules.test.ts`

---

- [ ] **P8-W18-T5**: 权限提示升级

  **说明**：权限提示展示模型意图、命令分类、命令文本、匹配规则、风险原因和可选决策。CLI 和 TUI 复用同一个 formatter，避免交互渠道行为分叉。

  **验收标准**：
  - 提示包含工具名、类别、摘要和风险说明
  - command 工具提示包含分类与匹配规则来源
  - read 工具默认不提示
  - TUI 和 CLI 展示内容一致
  - 单元测试覆盖 read/write/dangerous/unknown 展示

  **关键文件**：`src/permissions/prompt.ts`、`src/permissions/index.ts`、`src/tui/app.tsx`、`tests/permissions/prompt.test.ts`

## 验证要求

- 必跑：`npm test -- tests/permissions/*.test.ts tests/harness.test.ts tests/agent-loop-permission.test.ts tests/tools/run-command.test.ts`
- 修改 CLI/TUI 权限展示时补跑：`npm test -- tests/index.test.ts tests/tui/permission.test.tsx`
- 合并前跑：`npm run build` 和 `npm test`
