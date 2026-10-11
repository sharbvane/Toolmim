import { access, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createAgentSession, createReadToolDefinition, createWriteToolDefinition, defineTool,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession as PiSession, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { AgentSession, Bootstrap, RuntimeEvent, Settings, Skill } from '../shared/types.js';
import { runProcess } from './runner.js';

interface RuntimeOptions {
  dataDirectory: string;
  getSettings: () => Settings;
  getSkills: () => Skill[];
  getApiKey: () => Promise<string | undefined>;
}

const VERSION = '1.1.0';
const sensitivePath = /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.codex(?![\\/]skills(?:[\\/]|$))|\.pi(?![\\/](?:agent[\\/])?skills(?:[\\/]|$))|auth\.json|credentials(?:\.json)?|[^\\/]*\.(?:pem|key))($|[\\/])/i;
const contains = (root: string, file: string) => {
  const rel = relative(root, file);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/** Resolve symlinks and check the nearest existing ancestor before creating a file. */
export async function checkedPath(file: string, cwd: string, roots: string[], blocked: string[]) {
  const candidate = resolve(cwd, file);
  if (sensitivePath.test(candidate)) throw new Error('禁止访问凭据文件或个人 Agent 配置。');
  let existing = candidate;
  const missing: string[] = [];
  while (true) {
    try { existing = await realpath(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(basename(existing)); existing = parent;
    }
  }
  const canonical = join(existing, ...missing);
  const allowed = await Promise.all(roots.map(root => realpath(root)));
  const forbidden = await Promise.all(blocked.map(async root => {
    try { return await realpath(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(root); throw error; }
  }));
  if (sensitivePath.test(canonical) || !allowed.some(root => contains(root, canonical)) || forbidden.some(root => contains(root, canonical))) {
    throw new Error('路径超出当前工作目录或已启用 Skill 的读取范围。');
  }
  return canonical;
}

function redacted(text: string, key?: string) {
  const withoutKey = key ? text.split(key).join('[已隐藏密钥]') : text;
  return withoutKey.replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/g, '[已隐藏密钥]');
}

function resultText(result: unknown) {
  const value = result as { content?: { type: string; text?: string }[] };
  return (value?.content ?? []).map(item => item.type === 'text' ? item.text ?? '' : '[图片结果]').join('\n');
}

/** Host commands are opt-in; executable and arguments never pass through a shell. */
function commandTool(cwd: string) {
  return defineTool({
    name: 'run_command', label: '运行本地程序',
    description: 'Run an executable with a separate argument array in the working directory. No shell syntax. Command access has host-user permissions.',
    promptSnippet: 'Run an executable with an argument array',
    parameters: Type.Object({ command: Type.String(), args: Type.Array(Type.String()), timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 300 })) }),
    executionMode: 'sequential',
    async execute(_id, params, signal, onUpdate) {
      signal?.throwIfAborted();
      if (!params.command.trim() || params.command.includes('\0') || params.args.some((arg: string) => arg.includes('\0'))) throw new Error('程序和参数不能为空或包含 NUL。');
      const env: NodeJS.ProcessEnv = {};
      for (const name of ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'LANG']) {
        if (process.env[name]) env[name] = process.env[name];
      }
      const timeout = AbortSignal.timeout((params.timeoutSeconds ?? 120) * 1000);
      try {
        const result = await runProcess(params.command, params.args, { cwd, env, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          onLog: text => onUpdate?.({ content: [{ type: 'text', text }], details: {} }) });
        return { content: [{ type: 'text', text: (result.stdout + result.stderr).slice(-48_000) || '程序执行成功（无标准输出）' }], details: { exitCode: 0 } };
      } catch (error) { if (timeout.aborted && !signal?.aborted) throw new Error('程序超时'); throw error; }
    },
  });
}

export class PiRuntime {
  private runtime?: Promise<ModelRuntime>;
  private active?: PiSession;
  constructor(private options: RuntimeOptions) {}

  private getRuntime() {
    if (!this.runtime) this.runtime = this.createRuntime().catch(error => { this.runtime = undefined; throw error; });
    return this.runtime;
  }

  private async createRuntime() {
    const settings = this.options.getSettings();
    const runtime = await ModelRuntime.create({
      credentials: { read: async () => undefined, list: async () => [], modify: async (_provider, fn) => fn(undefined), delete: async () => {} },
      modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
    });
    const blockAmbientAuth = () => {
      for (const provider of runtime.getProviders()) {
        const auth = provider.auth.apiKey;
        if (!auth) continue;
        const resolveAuth = auth.resolve;
        auth.resolve = input => input.credential?.key ? resolveAuth(input) : Promise.resolve(undefined);
      }
    };
    // Pi's availability refresh may otherwise inspect environment keys and ambient cloud credentials.
    blockAmbientAuth();
    if (settings.baseUrl) {
      const url = new URL(settings.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('模型端点须是无内嵌凭据、查询参数和片段的 HTTP(S) URL。');
      runtime.registerProvider(settings.provider, {
        name: settings.provider, baseUrl: settings.baseUrl, api: 'openai-completions', authHeader: true,
        models: [{ id: settings.modelId, name: settings.modelId, input: ['text'], reasoning: false,
          contextWindow: 32_768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      });
      blockAmbientAuth();
    }
    return runtime;
  }

  async inspect(): Promise<Bootstrap['runtime']> {
    const settings = this.options.getSettings();
    const issues: string[] = [];
    let models: Bootstrap['runtime']['models'] = [];
    try {
      const runtime = await this.getRuntime();
      models = runtime.getModels().map(model => ({ provider: model.provider, id: model.id, name: model.name }));
      if (!runtime.getModel(settings.provider, settings.modelId)) issues.push('所选 Provider / 模型不在 Pi 模型目录。可选择已有模型或设置兼容端点。');
    } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    if (!settings.keyConfigured) issues.push('尚未配置项目专用 API Key，请在设置页保存。不会读取个人 Pi / Codex 的认证。');
    return { engine: '@earendil-works/pi-coding-agent', version: VERSION, connected: settings.keyConfigured && issues.length === 0, issues, models };
  }

  async invalidate() {
    this.runtime = undefined;
  }

  async run(session: AgentSession, text: string, options: { signal: AbortSignal; onEvent: (event: RuntimeEvent) => void; files?: string[] }): Promise<{ text: string; sessionFile: string }> {
    if (this.active) throw new Error('Pi 正在执行另一个任务，请等待队列。');
    options.signal.throwIfAborted();
    if (!text.trim()) throw new Error('消息不能为空。');
    const key = await this.options.getApiKey();
    if (!key) throw new Error('请先在设置页配置项目专用 API Key。');
    const settings = this.options.getSettings();
    const cwd = await realpath(session.cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Agent 工作目录不存在。');
    const runtime = await this.getRuntime();
    const model = runtime.getModel(settings.provider, settings.modelId);
    if (!model) throw new Error('Pi 无法找到所选模型，请检查设置中的 Provider 和模型。');
    await runtime.setRuntimeApiKey(settings.provider, key);
    const send = (event: RuntimeEvent) => options.onEvent(JSON.parse(JSON.stringify(event, (_name, value) => typeof value === 'string' ? redacted(value, key) : value)) as RuntimeEvent);
    const storage = resolve(this.options.dataDirectory, 'pi');
    const sessionDirectory = join(storage, 'sessions');
    await mkdir(sessionDirectory, { recursive: true });
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: false, provider: { timeoutMs: 120_000, maxRetries: 0 } },
      enableAnalytics: false, enableInstallTelemetry: false, cacheWarming: 'off', defaultProjectTrust: 'never',
    });
    const enabled = this.options.getSkills().filter(skill => skill.enabled);
    const skillPaths = enabled.map(skill => resolve(skill.path));
    const loader = new DefaultResourceLoader({
      cwd, agentDir: storage, settingsManager,
      additionalSkillPaths: skillPaths, noSkills: true,
      noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      appendSystemPrompt: ['请用中文回应。只报告实际执行的工作，不虚构工具结果或进度。自动发布必须在用户明确确认后通过专用工作流执行。'],
    });
    await loader.reload();
    const skills = loader.getSkills();
    for (const diagnostic of skills.diagnostics) send({ type: 'stage', text: `Skill 诊断：${diagnostic.message}` });
    const readRoots = [cwd, ...skills.skills.map(skill => skill.baseDir)];
    const blocked = [storage, ...['state.json', 'state.json.tmp', 'credentials.dpapi', 'credentials.dpapi.tmp'].map(name => join(this.options.dataDirectory, name))];
    const readTool = createReadToolDefinition(cwd);
    const writeTool = createWriteToolDefinition(cwd);
    const tools: ToolDefinition[] = [
      defineTool({ ...readTool, async execute(id, params, signal, update, ctx) {
        const path = await checkedPath(params.path, cwd, readRoots, blocked);
        return readTool.execute(id, { ...params, path }, signal, update, ctx);
      } }),
      defineTool({ ...writeTool, executionMode: 'sequential', async execute(id, params, signal, update, ctx) {
        const path = await checkedPath(params.path, cwd, [cwd], blocked);
        return writeTool.execute(id, { ...params, path }, signal, update, ctx);
      } }),
      defineTool({
        name: 'list_directory', label: '列出工作目录', description: 'List local workspace directory entries.', promptSnippet: 'List local directories',
        parameters: Type.Object({ path: Type.Optional(Type.String()) }),
        async execute(_id, params, signal) {
          signal?.throwIfAborted();
          const path = await checkedPath(params.path ?? '.', cwd, readRoots, blocked);
          const entries = (await readdir(path, { withFileTypes: true })).filter(item => !sensitivePath.test(item.name) && !blocked.some(root => contains(resolve(root), join(path, item.name))));
          return { content: [{ type: 'text', text: entries.slice(0, 500).map(item => item.name + (item.isDirectory() ? '/' : '')).join('\n') || '目录为空' }], details: {} };
        },
      }),
    ];
    if (settings.allowCommands) tools.push(commandTool(cwd));
    const images: { type: 'image'; data: string; mimeType: string }[] = [];
    const fileContexts: string[] = [];
    for (const file of options.files ?? []) {
      const path = await checkedPath(file, cwd, [cwd], blocked);
      if (!(await stat(path)).isFile()) throw new Error('文件上下文必须是文件。');
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' } as Record<string, string>)[extname(path).toLowerCase()];
      if (mime && !model.input.includes('image')) throw new Error('当前模型未声明图片输入能力，请选择支持图片的原生模型或使用文本上下文。');
      if (mime) {
        if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('图片上下文须小于 10 MB。');
        images.push({ type: 'image', mimeType: mime, data: (await readFile(path)).toString('base64') });
      } else fileContexts.push(path);
    }
    let manager: SessionManager;
    if (session.sessionFile) {
      const path = await checkedPath(session.sessionFile, sessionDirectory, [sessionDirectory], []);
      await access(path);
      manager = SessionManager.open(path, sessionDirectory, cwd);
    } else manager = SessionManager.create(cwd, sessionDirectory);
    session.sessionFile = manager.getSessionFile();
    send({ type: 'stage', text: `Pi 会话加载 ${skills.skills.length} 个已启用 Skill。` });
    let sdk: PiSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let failure: string | undefined;
    const abort = () => { void sdk?.abort(); };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      options.signal.throwIfAborted();
      ({ session: sdk } = await createAgentSession({
        cwd, agentDir: storage, modelRuntime: runtime, model, thinkingLevel: 'off',
        sessionManager: manager, settingsManager, resourceLoader: loader,
        tools: tools.map(tool => tool.name), customTools: tools,
      }));
      this.active = sdk;
      options.signal.throwIfAborted();
      unsubscribe = sdk.subscribe(event => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') send({ type: 'text_delta', text: event.assistantMessageEvent.delta });
        else if (event.type === 'tool_execution_start') send({ type: 'tool_start', tool: event.toolName, data: { id: event.toolCallId, args: event.args } });
        else if (event.type === 'tool_execution_update') send({ type: 'tool_update', tool: event.toolName, text: resultText(event.partialResult) });
        else if (event.type === 'tool_execution_end') send({ type: 'tool_end', tool: event.toolName, text: resultText(event.result), data: { id: event.toolCallId, isError: event.isError } });
        else if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') {
          failure = event.message.errorMessage || '模型返回错误'; send({ type: 'error', text: failure });
        } else if (event.type === 'auto_retry_start') send({ type: 'stage', text: event.errorMessage });
        else if (event.type === 'compaction_start') send({ type: 'stage', text: 'Pi 正在压缩会话上下文。' });
      });
      const prompt = fileContexts.length ? `${text}\n\n用户选择的本地上下文文件（使用 read 工具读取）：\n${fileContexts.map(path => JSON.stringify(path)).join('\n')}` : text;
      await sdk.prompt(prompt, { images, source: 'interactive' });
      options.signal.throwIfAborted();
      if (failure) throw new Error(failure);
      return { text: redacted(sdk.getLastAssistantText() ?? '', key), sessionFile: manager.getSessionFile()! };
    } catch (error) {
      throw new Error(redacted(error instanceof Error ? error.message : String(error), key), { cause: error });
    } finally {
      options.signal.removeEventListener('abort', abort);
      unsubscribe?.();
      await sdk?.abort();
      sdk?.dispose();
      this.active = undefined;
    }
  }
}
