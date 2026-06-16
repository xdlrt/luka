import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspress/core";
import mermaid from "rspress-plugin-mermaid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "docs/claude-code-learning",
  outDir: "doc_build/claude-code-learning",
  base: "/coding-agent/",
  globalStyles: path.join(
    __dirname,
    "docs/claude-code-learning/styles/geek.css"
  ),
  title: "拆解 Claude Code",
  description:
    "一本写给所有人的书：拆解一个编程智能体内部的设计与权衡。",
  lang: "zh",
  markdown: {
    showLineNumbers: true,
  },
  plugins: [
    mermaid({
      mermaidConfig: {
        theme: "neutral",
      },
    }),
  ],
  themeConfig: {
    search: true,
    lastUpdated: true,
    nav: [
      { text: "封面", link: "/" },
      { text: "前言", link: "/preface" },
      { text: "导言", link: "/introduction" },
      { text: "正文", link: "/chapters/01-agentic-loop" },
      { text: "附录", link: "/appendix/conclusion" },
    ],
    sidebar: {
      "/": [
        {
          text: "卷首",
          items: [
            { text: "封面与目录", link: "/" },
            { text: "前言：为什么值得拆解", link: "/preface" },
            { text: "导言：一次请求的幕后旅程", link: "/introduction" },
          ],
        },
        {
          text: "第一部分　核心运行闭环",
          collapsible: true,
          items: [
            { text: "第 1 章　为什么一次对话不够", link: "/chapters/01-agentic-loop" },
            { text: "第 2 章　工具：让模型动手的协议", link: "/chapters/02-tools" },
            { text: "第 3 章　上下文与记忆", link: "/chapters/03-context" },
          ],
        },
        {
          text: "第二部分　权限与安全",
          collapsible: true,
          items: [
            { text: "第 4 章　权限、沙箱与安全护栏", link: "/chapters/04-permission-safety" },
          ],
        },
        {
          text: "第三部分　扩展与协作",
          collapsible: true,
          items: [
            { text: "第 5 章　Skill：可发现的能力", link: "/chapters/05-skill" },
            { text: "第 6 章　连接外部世界", link: "/chapters/06-service-integrations" },
            { text: "第 7 章　插件与扩展治理", link: "/chapters/07-plugin" },
            { text: "第 8 章　子智能体与任务编排", link: "/chapters/08-sub-agent" },
          ],
        },
        {
          text: "第四部分　交互与工作流",
          collapsible: true,
          items: [
            { text: "第 9 章　命令行、终端界面与会话", link: "/chapters/09-cli-tui" },
            { text: "第 10 章　输入与输出体验", link: "/chapters/10-input-output" },
            { text: "第 11 章　Git 与 GitHub 工作流", link: "/chapters/11-git-github" },
          ],
        },
        {
          text: "第五部分　状态与可观测",
          collapsible: true,
          items: [
            { text: "第 12 章　状态、记忆与配置治理", link: "/chapters/12-state-config" },
            { text: "第 13 章　可观测、评估与追踪", link: "/chapters/13-observability" },
          ],
        },
        {
          text: "第六部分　连接万物",
          collapsible: true,
          items: [
            { text: "第 14 章　IDE、远程与服务端桥接", link: "/chapters/14-bridge" },
          ],
        },
        {
          text: "卷尾",
          items: [
            { text: "结语：带走的设计原则", link: "/appendix/conclusion" },
            { text: "附录 A　术语表", link: "/appendix/glossary" },
            { text: "附录 B　Claude Code 模块地图", link: "/appendix/module-map" },
            { text: "附录 C　延伸阅读", link: "/appendix/further-reading" },
          ],
        },
      ],
    },
  },
});
