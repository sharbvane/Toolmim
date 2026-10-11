# 第三方项目与许可边界

核对日期：2026-10-11。Toolmim 自身代码按 [MIT](LICENSE) 发布。此许可不覆盖独立安装的 Skills、执行器、模型、用户素材及其产物，也不替代第三方服务的使用条款。

## 应用依赖

依赖通过 npm 安装，版本锁定在 `package-lock.json`，不将 `node_modules` 提交到仓库。发布依赖的许可证与版权文件保留在各自包内。

| 依赖 | 许可证 | 用途 |
| --- | --- | --- |
| [Pi coding agent](https://github.com/earendil-works/pi/blob/main/LICENSE) | MIT | Agent 核心运行时，固定 1.1.0 |
| React / React DOM | MIT | 前端 |
| Fastify / multipart / static | MIT | 本地 API、上传与静态页面 |
| TypeBox | MIT | Schema |
| Lucide React | ISC | 图标 |
| Vite / React plugin / tsx | MIT | 构建与 TypeScript 执行 |
| TypeScript / Playwright | Apache-2.0 | 类型检查与浏览器测试 |
| Node / React 类型声明 | MIT | 开发类型定义 |

传递依赖按各自包的许可使用；依赖树由锁文件完整记录。FFmpeg、Python 与浏览器属于用户另行安装的运行工具，其许可随具体发行包而定。

锁文件许可元数据共 310 个包条目，无缺失：MIT、Apache-2.0、ISC、BSD-3-Clause、CC-BY-4.0、Unlicense、BlueOak-1.0.0、0BSD。`caniuse-lite` 的浏览器兼容数据采用 CC-BY-4.0，来自 [Can I Use](https://caniuse.com/)，npm 包中保留原许可；未将其数据单独复制分发。

## 可选 Skills 与执行器

这些项目均由用户独立安装。仓库不包含其引擎、Skill 正文、声材、模型或测试媒体。适配器调用原项目入口，保留上游报告；`server/bmts-lite-runner.py` 是 Toolmim 自编的薄桥接文件，通过独立子进程导入外部安装的 `worker.run`，不包含混剪引擎实现。

| 项目 | 上游许可 | 注意事项 |
| --- | --- | --- |
| [onetake](https://github.com/feitangyuan/onetake/blob/main/LICENSE) | PolyForm Noncommercial 1.0.0 | 限非商业用途，不能将其视为 MIT 或无使用限制的开源组件 |
| [Hypit](https://github.com/hypit-ai/hypit/blob/main/LICENSE) | Hypit Open Source License，修改版 Apache 2.0 | 有附加条件，包括多租户服务、商业再分发及标识保留；以原文为准 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload/blob/main/LICENSE) | MIT | 账号及 Cookie 由该独立项目管理 |
| [BGM Montage](https://github.com/sharbvane/bgm-montage) | AGPL-3.0-or-later（项目声明） | 引擎与其修改保持原许可；不会被 Toolmim 的 MIT 重新授权 |
| [BMTS Lite](https://github.com/sharbvane/BMTS-Lite/blob/main/LICENSE) | AGPL-3.0-only（项目声明） | 同上，独立安装并通过桥接进程运行 |

若后续复制、修改、捆绑分发上游代码，或改变独立执行器与应用的集成边界，需要重新核对相应许可证及来源说明。当前公开源码仅包含 Toolmim 应用、适配代码、文档与自编测试。
