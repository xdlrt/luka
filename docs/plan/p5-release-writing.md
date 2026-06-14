# P5: 成作品 — 开源打磨 + 技术文章

> **里程碑**：形成可对外发布的开源仓库，并完成技术文章。

## 任务清单
- [x] **P5-W14-T1**: 清理代码

  **说明**：审查所有源文件，确保命名一致，无 `any` 类型残留。`tsc --noEmit` 零报错。

  **验收标准**：
  - 所有导出符号有 JSDoc
  - 源码零 `any` 类型
  - 无未使用的 import 和死代码
  - 命名风格统一
  - `tsc --noEmit` 通过

  **关键文件**：所有 `src/**/*.ts`

---

- [x] **P5-W14-T2**: 编写完整 README

  **说明**：重写 README：项目概览、Mermaid 架构图、安装/配置说明、使用示例（含终端截图或代码块）、配置参考、持续 eval 结果、设计决策/权衡、contributing、license。

  **验收标准**：
  - 别人 clone 后能在 5 分钟内跑起来
  - 架构图展示 6 个模块及关系
  - 至少 3 个使用示例（简单任务、多文件任务、带验证任务）
  - 配置表文档化所有环境变量和 CLI 参数
  - 设计决策章节解释关键权衡

  **关键文件**：`README.md`

---

- [x] **P5-W14-T3**: 配置 npm 脚本、bin 入口、打包

  **说明**：配置 `package.json`：`"bin"` 字段指向编译后的 CLI、`"files"` 字段限定发布内容、`"engines"` 要求 Node >= 20。入口文件添加 shebang。本地验证 `npx .` 正常运行。

  **验收标准**：
  - `npm link` 后 `coding-agent "修复这个 bug"` 可从任何目录运行
  - `package.json` 中 `bin`、`files`、`engines`、`"type": "module"` 正确
  - 入口文件有 `#!/usr/bin/env node`
  - `npm pack` 产出的 tarball 纯净
  - `.npmignore` / `files` 排除：tests、evals、.env、.git

  **关键文件**：`package.json`（修改）、`src/index.ts`（添加 shebang）、`.npmignore`

---

- [x] **P5-W14-T4**: 录制 Demo 并加入 README

  **说明**：用 `asciinema` 录制终端 demo：(1) Agent 修复失败测试、(2) 权限确认提示出现、(3) TODO 列表展示。嵌入 README。

  **验收标准**：
  - 录制约 60 秒的完整任务 demo
  - 清晰展示：工具调用过程、权限提示、测试验证、成功
  - 嵌入 README

  **关键文件**：`README.md`（嵌入 demo）、`docs/demo.cast`

---

- [x] **P5-W14-T5**: 添加 LICENSE、CONTRIBUTING.md、GitHub 模板

  **说明**：添加 MIT License。创建最小 CONTRIBUTING.md。添加 GitHub issue/PR 模板。

  **验收标准**：
  - `LICENSE` — MIT 许可证
  - `CONTRIBUTING.md`：开发环境搭建、测试运行、代码风格、PR 流程
  - `.github/ISSUE_TEMPLATE/bug_report.md` 和 `feature_request.md`
  - `.github/pull_request_template.md`

  **关键文件**：`LICENSE`、`CONTRIBUTING.md`、`.github/` 下模板文件

---

- [ ] **P5-W15-T1**: 撰写技术文章大纲和引言

  **说明**：创建 `docs/article-draft.md`。文章结构：(1) 为什么要从零手写 Coding Agent、(2) Agent Loop 模式解析、(3) 工具调用协议深挖、(4) Harness：让 AI 可控、(5) 自验证回路、(6) 经验教训。写引言（500 字）。

  **验收标准**：
  - 完整大纲，每节有要点
  - 引言有吸引力
  - 每节标注要展示的代码片段
  - 目标篇幅：3000-4000 字

  **关键文件**：`docs/article-draft.md`

---

- [ ] **P5-W15-T2**: 撰写文章核心章节（Agent Loop + Harness）

  **说明**：写第 2-4 节：Agent Loop 模式、工具调用协议、Harness 设计。包含真实代码片段。着重解释每个设计决策的"为什么"。

  **验收标准**：
  - Agent Loop 节：解释 while 循环、停止条件、消息格式
  - 工具调用节：展示 JSON Schema 定义、执行、结果格式
  - Harness 节：解释权限模型、安全分层
  - 代码片段来自真实代码库
  - 每节约 600-800 字

  **关键文件**：`docs/article-draft.md`（修改）

---

- [ ] **P5-W15-T3**: 撰写文章剩余章节和结论

  **说明**：写第 5-6 节：自验证回路和经验教训。包含 P4 可观测与持续评测平台产出的趋势数据。结论 200-300 字，前瞻性。

  **验收标准**：
  - 自验证节：展示重试循环、测试解析、最大尝试次数
  - 经验教训：至少 5 条具体洞察
  - 包含持续 eval 趋势表作为证据
  - 结论有前瞻性
  - 全文 3000-4000 字，通读连贯

  **关键文件**：`docs/article-draft.md`（修改）

---

- [ ] **P5-W15-T4**: 最终 eval 运行 + 项目复盘

  **说明**：使用 P4 可观测与持续评测平台执行发布前全量 eval。与 P2、P3 基线和 P4 持续趋势对比。在 `docs/retrospective.md` 写项目复盘：做得好的、比预期难的、下次会不同的。

  **验收标准**：
  - 最终 eval 结果已保存
  - 对比表：P2 基线 → P3 → P4 趋势 → P5 发布前结果
  - 复盘覆盖：时间线遵守情况、技术难点、关键学习
  - 后续改进项含具体证据
  - 所有代码已提交、所有测试通过
  - **P5 里程碑达成**：可对外发布的开源项目 + 技术文章完成

  **关键文件**：`evals/results/{date}-final.json`、`docs/retrospective.md`、`README.md`（最终 eval 更新）

---
