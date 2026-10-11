# 四个适配器的实际能力与验证范围

核对日期：2026-10-11。读取了各项目当日官方 README、入口源码、Skill / 使用文档和许可文件；本机状态另用实际进程探测，不能把上游文档声明当作已跑通。

本工具箱不复制四个项目的引擎，不改现有项目源代码；设置指定现有安装。任务素材、工作文件和缓存放在独立任务目录，原视频和音频只读。进程通过 `spawn(command, args, {shell:false})` 启动；取消沿用统一进程树清理。

| 功能 | 真实入口 | 本机发现 | 本次验证 | 尚未验证 / 接通 |
| --- | --- | --- | --- | --- |
| 动效宣传片 | onetake Skill + `scripts/probe.py` / `render.py` / `verify_promo.py` | 独立安装的 onetake Skill，有独立 `.venv` | 实际 `render.py --help`、模块导入、Chromium 启动 | 没有用户模型认证；未完成模型创意 → 分镜 → 成片完整流程 |
| 复刻视频 | Hypit Skill + `bin/hypit.mjs`；官方 `check` / `plan` | 未发现可执行安装 | 最新官方入口和命令源码核对；缺安装诊断 | 未运行 Hypit；自动 Build、持久 Worker 的精确取消、成片导出尚未接通 |
| 自动发布 | `sau_cli.py`（发行包命令 `sau`） | 未发现本地安装 | 官方平台级 CLI 源码核对；测试替身验证“检查 → 预览 → bool 确认 → 上传”门禁 | 未检查真实登录账号；未上传或发布任何内容 |
| 简化混剪 | 同作者官方 BMTS Lite 的 `worker.run(directory, request, update)` | 设置中配置的独立执行器目录，复用兼容的 BGM 独立 `.venv` | 六个本地视频 + 8 秒真实节拍音频 → 实际成片；上游校验、完整解码和原素材哈希检查通过 | 不包含参考匹配、内容语义选片或 Agent 视觉审片 |
| 专业混剪 | BGM Montage 的 `scripts/bgm_montage.py` | 设置中配置的独立执行器目录，v1.4.6 | 实际 `--help` / `--version`；无参考运行暴露真实上游限制 | 本次未完成带参考的专业渲染；需要已准备的真实 CLIP 模型 |

## onetake：创作 Skill，不是传统剪辑 CLI

来源：[官方项目](https://github.com/feitangyuan/onetake)、[Skill 协议](https://github.com/feitangyuan/onetake/blob/main/SKILL.md)、[composition 契约](https://github.com/feitangyuan/onetake/blob/main/references/composition.md)、[许可](https://github.com/feitangyuan/onetake/blob/main/LICENSE)。

MVP 参数为产品名称、介绍、URL / 截图素材、宣传重点、10–30 秒片长与六个已提供的 look。固定输出 1920×1080、30 fps 草稿；未展示未验证的任意画幅与旁白生成。上游支持更长的讲解片和最终 4K60，但本次没有增加对应入口。

执行分成真实的两个任务阶段：

1. Pi 读取已启用的 `SKILL.md`，返回三个不同视觉概念。只接受恰好三份结构化方案，持久保存；等待用户选择 0 / 1 / 2。
2. Pi 按选择方案实际写入 `storyboard.md`、`comp.html` 和 `score.py`，从上游声材制作音效。适配器检查文件存在，并运行真实 `probe.py`、`render.py`、`verify_promo.py`；失败使任务失败。

HTML 契约是 `window.__seek(t)`、`window.__ready`、`window.__meta.dur` / `inFrame` 与 `__track`，遵照上游确定性 seek 和连续性检查。适配器并非固定模板渲染，成片质量取决于真实模型创作和上游验收。

依赖：Python 的 Playwright、numpy、scipy、Pillow、matplotlib、opencv；Chromium；FFmpeg / ffprobe；Pi 模型认证及用户开启的命令工具；当前 Skill 已导入且启用。首次实际探针发现 Chromium 缺失，已在该 Skill 自有环境执行官方 `python -m playwright install chromium`，随后实际无头启动通过。未读取个人模型凭据。

上游许可标记为 PolyForm Noncommercial 1.0.0；仅为独立安装的外部执行器提供适配，不分发或重新许可该 Skill；使用须遵守其原许可证。

## Hypit：真实工作流检查，导出仍待接通

来源：[官方 README](https://github.com/hypit-ai/hypit)、[安装与生命周期](https://github.com/hypit-ai/hypit/blob/main/skills/hypit/references/environment/distribution.md)、[Build 命令](https://github.com/hypit-ai/hypit/blob/main/skills/hypit/references/production/builds.md)、[CLI 源码](https://github.com/hypit-ai/hypit/blob/main/packages/cli/src/arguments.ts)、[许可](https://github.com/hypit-ai/hypit/blob/main/LICENSE)。

核对的主分支包为 `@hypit/hypit` 0.3.1，Node >=22.15.0，入口 `bin/hypit.mjs`。Skill 和可执行发行包独立安装；`hypit version` / `paths` / `--help` 用来识别当前安装，不能凭已导入 SKILL.md 认定 CLI 可运行。

参数为参考视频、保留要求、替换内容、目标比例和 1–5 份工作流变体。比例和内容变化是由 Pi 在 Hypit 工作流中创作，不冒称存在 `hypit clone --variants --ratio` 一类 CLI。

安装条件齐备后，适配器让 Pi 实际编写 Source / Recipe / `variant-N.svrun`，再执行 `hypit check <run>` 与 `hypit plan <run> --json`，保存计划。当前停止在明确标注的工作流计划等待态，不产生“成片成功”。未安装时入口禁用并给出修复指引。

上游 `build --follow` 只是观察；关闭观察进程不会取消后台 Worker 的 Build。正确取消需要精确 Build ID 和 `hypit cancel <id>`。这个持久执行桥与导出尚未实现和验证，所以本次不启动它。涉及生成服务时还取决于所选 Endpoint、Profile、凭据与准备状态；本次没有使用这些服务。许可为上游 Hypit Open Source License（修改版 Apache 2.0），输出归属与第三方服务规则以其原文为准。

## social-auto-upload：逐平台检查与显式确认

来源：[官方 README](https://github.com/dreammis/social-auto-upload)、[sau 入口](https://github.com/dreammis/social-auto-upload/blob/main/sau_cli.py)、[pyproject](https://github.com/dreammis/social-auto-upload/blob/main/pyproject.toml)、[抖音 CLI 契约](https://github.com/dreammis/social-auto-upload/blob/main/skills/douyin-upload/references/cli-contract.md)、[许可](https://github.com/dreammis/social-auto-upload/blob/main/LICENSE)。

核对入口为 `sau = sau_cli:main`，Python >=3.10,<3.13，依赖包括 patchright、loguru、OpenCV 等。MVP 明确支持已核对的抖音、快手、小红书、B 站、视频号、YouTube、百家号平台；不从 README 广泛列举就声称每个平台全参数已接通。

| 命令 | 实际参数 / 限制 |
| --- | --- |
| `<platform> check` | `--account <account_name>`；检查显式账号，不自动收集个人 Cookie |
| `<platform> upload-video` | `--account`、`--file`、`--title`、`--desc`、`--tags` |
| 定时 | `--schedule "YYYY-MM-DD HH:mm"`；此 MVP 只给抖音、快手、小红书、B 站、视频号使用 |
| B 站 | 额外要求描述和 `--tid` 实际分区 ID |

统一账号名可用逐平台 JSON 覆盖；JSON 只能包含已支持的平台到合法账号名的映射，禁止未知键 / 非字符串值，拒绝误贴 Cookie JSON。真实 Cookie 始终由上游安装管理；前端不读取、保存或显示其内容。原始发布 CLI 日志完全不转发，避免秘密进入任务日志。

上传前用 FFmpeg 检查素材、逐平台运行 `check`，得到预览和真实登录可用状态。没有严格的 `confirmed === true`，只返回等待态；任一账号无效也不上传。失败或中断时逐平台记录为 `unknown`，保留 report 并停止后续平台；需要先去平台核查，避免重复发布。CLI 退出成功仅标为 `cli_success`，并不代替平台页面确认。

自动单元测试使用名称明确的 CLI 测试替身，验证预览、字符串 `'true'` 不触发上传，布尔 `true` 才触发。它不代表真实账号或发布验证。本机没有安装上游项目，也没有调用真实平台上传。MIT 许可。

## BGM：模式按真实入口区分

来源：[BGM Montage](https://github.com/sharbvane/bgm-montage)、[统一 CLI](https://github.com/sharbvane/bgm-montage/blob/main/scripts/bgm_montage.py)、[同项目 Lite Release](https://github.com/sharbvane/bgm-montage/releases/tag/v0.1.1-lite)、[官方 BMTS Lite 源码](https://github.com/sharbvane/BMTS-Lite)、[Lite worker](https://github.com/sharbvane/BMTS-Lite/blob/main/worker.py)。

### 默认 Lite 模式：多视频 + 整首音乐

使用同作者发布的真实 BMTS Lite 0.1.1 独立源码。`server/bmts-lite-runner.py` 仅解析 request、导入独立安装的 `worker.run`、传递上游阶段回调和保存已通过检查的报告；音乐分析、卡点规划、随机源选段、模糊填充、分批渲染和完整解码都由现有上游引擎执行。没有复制或自制混剪实现冒充上游。

支持 1–600 秒整首音乐、至少两个用户选择视频（MVP）、上游最多 100 段视频 / 合计 4 GiB、选定画幅。上游 worker 还支持 auto、4:3、3:4；MVP 只呈现四种共同验证的画幅。`count` 是适配器逐次实际调用 1–5 次，不是伪造上游批量参数。不同任务目录名作为上游随机种子；每条输出独立保存。

Lite 不接受目标时长、主题、视觉风格或参考片；这些字段在 Lite 界面隐藏。它不会截断音轨，也没有内容语义筛选或参考风格学习。许可 AGPL-3.0-only；运行依赖用现有兼容的独立 BGM `.venv` 实际导入验证（numpy 2.4.6、scipy 1.17.1 等），不安装到系统 Python。

本次真实自测：

重新执行时先设置 `TOOLMIM_TEST_VIDEOS` 为自有 MP4 素材目录、`TOOLMIM_TEST_MONTAGE_ROOT` 为独立执行器根目录；需要指定 Python 时设置 `TOOLMIM_TEST_PYTHON`。这些本机路径不写入源码，测试不会自动读取应用设置或公开用户素材。

```powershell
node node_modules/tsx/dist/cli.mjs tests/adapters-real.ts --montage
```

验证产物保存在本地忽略提交的数据目录。以六个自有测试 MP4 加 FFmpeg 生成的 8 秒节拍音频实际运行，上游返回 4 个镜头；产物 `outputs/real-montage-1/result.mp4`。ffprobe：1920×1080、30/1 fps、H.264 / AAC、8.010026 秒。上游音轨 / 尺寸 / 时长检查、上游和适配器全解码通过，六个原视频 SHA-256 没有改变。另查看了实际输出帧；未对整片进行人工审美验收。自测不接触外部账户，不公开发布用户素材。

### 专业模式：本地素材库 + 参考

真实 v1.4.6 CLI 支持：

```text
--source-provider local-library --local-library-dir PATH
--bgm FILE --theme TEXT --duration SECONDS --ratio RATIO
--output-dir PATH --reference-dir PATH --cache-dir PATH
--material-dir PATH --agent-visual-review off --usage-mode local_evaluation
```

**实测差异：** 官方 README 图示写“参考可选”，但本机当前统一入口在空参考目录于第二阶段失败：`Reference profile contains no per-video summaries; run analyze_references first`。失败证据保存在本地数据目录。因此专业模式明确要求参考片；单纯多视频 + BGM 使用 Lite，不把文档中的可选声明伪装成已验证能力。

专业入口只读取任务内复制的参考片，缓存 / 输出在其他任务子目录；使用 `BGM_MONTAGE_SEMANTIC_OFFLINE=1` 要求已缓存真实 CLIP，不自动下载模型，不偷偷降级语义分析。程序化 QA 使用上游真实 `run_report.passed` 和成片解码；无用户视觉 Agent 审片的无人值守运行依照 README 使用 `--agent-visual-review off`，结果会明确标注。专业路径许可 AGPL-3.0-or-later。

### 能力探测与测试边界

```powershell
node node_modules/tsx/dist/cli.mjs tests/adapters-real.ts
node node_modules/tsx/dist/cli.mjs --test tests/adapters.test.ts
```

第一条实际探测四项依赖并保存 `diagnostics.json`；第二条两个测试均通过，包括参数边界、平台差异、账号 JSON 和发布门禁。真正的耗时渲染需要显式 `--montage`，不夹在每次单元测试中。应用内任务 / UI / Pi SDK 的测试结果见主 README 和实现报告。

尚未接通的功能：有真实模型创作的 onetake 完整成片验证、Hypit 自动 Build / 精确取消 / 导出、social 真账号连通与平台发布、专业参考模式完整渲染。本次不把这些项标为成功。
