# P7: 文件 Diff 与验证闭环增强

> **里程碑**：每次代码修改都有可读 diff、冲突保护和更强的验证失败回传，让用户能理解改动，模型能收敛修复。

## 任务清单

- [ ] **P7-W17-T1**: 生成编辑前后 unified diff 摘要

  **说明**：`write_file` 和 `edit_file` 成功后生成 unified diff 摘要。新增文件、覆盖文件和精确替换都要有稳定格式。diff 摘要进入工具结果、运行 summary 和 TUI `/diff`。

  **验收标准**：
  - 新增文件显示完整新增摘要
  - 覆盖文件显示变更 hunk
  - `edit_file` 显示替换前后上下文
  - diff 过长时截断并提示
  - 单元测试覆盖新增、覆盖、替换、多文件和截断

  **关键文件**：`src/diff.ts`、`src/tools/write-file.ts`、`src/tools/edit-file.ts`、`tests/diff.test.ts`

---

- [ ] **P7-W17-T2**: Harness 汇总 session diff

  **说明**：Harness 收集本次 session 的文件级 diff 摘要，供 CLI/TUI summary 和 `/diff` 使用。diff 只作为用户可见和模型修复上下文，不改变工具协议的安全边界。

  **验收标准**：
  - 每次成功写入或编辑后记录文件路径和 diff 摘要
  - 多次修改同一文件时保留时间顺序
  - `/diff` 展示当前 session 的 diff 列表
  - 没有改动时 `/diff` 显示无改动
  - 单元测试覆盖多文件、多次修改和无改动

  **关键文件**：`src/harness.ts`、`src/session-summary.ts`、`src/tui/app.tsx`、`tests/harness.test.ts`、`tests/tui/app.test.tsx`

---

- [ ] **P7-W17-T3**: 文件外部修改冲突检测

  **说明**：读取文件时记录 mtime/hash，编辑时如果文件已被外部修改，拒绝覆盖并要求模型重新 `read_file`。首版对 `edit_file` 强制检测；`write_file` 覆盖已有文件时也应提示或拒绝，避免静默覆盖用户改动。

  **验收标准**：
  - 无冲突时编辑成功
  - 文件读取后被外部修改时，`edit_file` 返回冲突错误
  - 冲突错误提示重新读取文件
  - `write_file` 覆盖已有文件时保留当前覆盖语义，但 summary 必须明确是覆盖写入；如启用冲突检测则必须测试
  - 单元测试覆盖无冲突、mtime/hash 变化和重新读取后成功

  **关键文件**：`src/file-state.ts`、`src/tools/read-file.ts`、`src/tools/edit-file.ts`、`tests/file-state.test.ts`

---

- [ ] **P7-W17-T4**: 验证失败上下文升级

  **说明**：验证失败时回传给模型的信息包含失败摘要、相关 diff、重试次数、剩余次数和下一步约束。达到 `maxRetries` 后停止自动修复，并在最终 summary 中说明。

  **验收标准**：
  - 测试失败消息包含失败摘要和相关 diff
  - 重试消息包含当前尝试次数和最大次数
  - 达到上限后 `success: false`
  - 测试通过后停止重试
  - 单元测试覆盖失败后修复、持续失败、达到上限和通过停止

  **关键文件**：`src/verification/retry-loop.ts`、`src/verification/format-results.ts`、`src/harness.ts`、`tests/agent-loop-retry.test.ts`

---

- [ ] **P7-W17-T5**: 明确未验证状态与测试命令建议

  **说明**：未配置 `testCommand` 时，最终 summary 明确显示“未运行验证”。可选新增 `--suggest-test-command`，让 agent 只建议测试命令，不自动执行。禁止引入静默默认测试命令。

  **验收标准**：
  - 无 `testCommand` 时不运行测试
  - summary 显示未运行验证
  - `--suggest-test-command` 从 prompt 中剥离
  - 建议测试命令不会自动执行
  - 单元测试覆盖有测试命令、无测试命令和建议模式

  **关键文件**：`src/index.ts`、`src/session-summary.ts`、`src/config.ts`、`tests/index.test.ts`、`tests/config.test.ts`

## 验证要求

- 必跑：`npm test -- tests/diff.test.ts tests/tools/edit-file.test.ts tests/tools/write-file.test.ts tests/verification/*.test.ts tests/agent-loop-verification.test.ts tests/agent-loop-retry.test.ts`
- 修改 CLI flag 时补跑：`npm test -- tests/config.test.ts tests/index.test.ts`
- 合并前跑：`npm run build` 和 `npm test`
