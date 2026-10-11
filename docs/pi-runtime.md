# Pi 运行时接入与验证

检查日期：2026-10-11。项目安装并锁定 `@earendil-works/pi-coding-agent@1.1.0`，最低 Node.js 为 22.19.0，许可证 MIT。直接使用 TypeScript SDK，未替换成 Codex 或聊天接口转发器。

依据：[官方项目](https://github.com/earendil-works/pi)、[SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[会话示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/11-sessions.ts)、[Skills 示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/04-skills.ts)、[许可证](https://github.com/earendil-works/pi/blob/main/LICENSE)。同时核对 npm 发布包内的 `.d.ts` 和 JavaScript 源码；以下接口针对已安装的 1.1.0，不以主线文档推测参数。

## 接入边界

`server/pi-runtime.ts` 使用真实 `ModelRuntime.create()`、`createAgentSession()`、`SessionManager.create/open()`、`DefaultResourceLoader`。Pi 管理消息、模型请求、工具循环、事件与 JSONL 会话；本项目管理任务队列、权限、确认、设置与产物。

- 原生 Provider / 模型从 SDK 模型目录选取。设置自定义端点后，以 `registerProvider()` 注册 OpenAI Chat Completions 兼容模型。自定义模型保守声明为文本输入，32,768 上下文 / 4,096 输出；这些是本项目请求配置，不是供应商能力或价格认证。
- API Key 从项目的 Windows DPAPI 凭据存储传入 `setRuntimeApiKey()`，SDK 凭据存储为空，不读个人 `auth.json` / `models.json`。Provider 认证解析限制为显式项目凭据，阻止环境与云账号的自动认证回退。
- `inspect().connected` 表示项目配置就绪，不表示网络连接成功。真实模型测试必须在设置页触发；无密钥时明确失败，不启动虚假 Agent。
- 每次执行创建 SDK 会话，已存在的项目会话以 JSONL 恢复。会话文件写入 `.data/pi/sessions`。运行前记录会话路径，即使首轮失败或取消也可保留真实用户输入。
- 事件输出包括文本增量、工具开始 / 更新 / 完成、阶段与模型错误。SDK 原始图片 base64 不发送到任务日志。项目密钥及常见 Bearer / Token 格式在事件和异常中脱敏。
- `AbortSignal` 调用 Pi 的 `abort()`；结束时取消订阅并 `dispose()`。配置 / Skills 变更在下次执行生效，不把当前正在执行的任务静默中止并误记为完成。
- 通过 `additionalSkillPaths` 载入已启用的本地 Skills。`noSkills:true` 关闭默认发现，但 1.1.0 仍加载明确传入的路径；已用 SDK 集成测试验证。默认 Extensions、提示模板、个人上下文文件与主题均禁用。

## 工具与权限

仅注册 `read`、`write`、`list_directory`；启用命令权限后增加 `run_command`。SDK 的默认 bash / PowerShell / edit 工具不在允许列表。读文件可访问当前工作目录和已启用 Skill 的目录；写文件仅允许当前工作目录。校验使用真实路径，拒绝 `..` 逃逸、目录联接 / 符号链接逃逸、个人凭据、项目会话存储、状态文件与加密密钥文件。允许明确导入的 `.codex/skills` 与 `.pi/agent/skills` 资源，但不开放这些配置目录中的其他文件。

`run_command` 的程序名与参数数组分开，`shell:false`，复用项目 `runProcess`，仅继承运行所需的基础环境变量。默认超时 120 秒，最高 300 秒；取消在 Windows 使用 `taskkill /T /F` 清理子进程树。命令权限具有当前宿主用户的文件与网络权限，并非沙箱。需要强隔离时须另外使用容器 / OS 沙箱；本 MVP 不声称实现此能力。

图片上下文只在原生模型声明 `input` 包含 `image` 时上传给模型，单图片上限 10 MB；自定义兼容端点不推测图片能力。其他文件作为受控路径上下文，由 Agent 调用真实 `read` 读取。

## 已执行的检查

```powershell
npm view @earendil-works/pi-coding-agent version engines dist.tarball --json
node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js --help
npx tsx --test tests/pi-runtime.test.ts
npx tsx --test tests/pi-runtime.test.ts tests/api.test.ts
```

CLI 帮助实际执行成功。运行时测试 **5 / 5 通过**：无项目认证阻止运行；路径 / 凭据 / junction 边界；真实 Pi SDK 读取和写入真实文件、流式事件、明确 Skill 发现和 JSONL 恢复；真实 Node 子进程的执行与取消后 PID 清理；取消模型流并继续重试。

联合 API 检查 **14 / 14 通过**，另涵盖本地 Host / Origin / 操作标识、字段校验、真实 Windows DPAPI 存储、Bootstrap 密钥隔离、文件上传与 Range、无密钥任务失败 / 重试、上下文凭据与 junction 拒绝、连接检查不覆盖用户文件、Skill 导入 / 启停 / 重扫。全项目 `npx tsc --noEmit` 同次通过。

测试模型端点是明确标注的本地协议 fixture，供应商流式响应由测试控制。测试验证真实 SDK、会话与工具执行，不等同于真实外部 LLM 连通或模型生成质量。没有使用用户已有个人 API Key，因此外部模型消息与工具调用仍须用户在项目设置提供凭据后验证。
