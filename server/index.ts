import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { initialCards, validateFields, workflows } from './cards.js';
import { KeyVault, directory, existingFile, redact } from './security.js';
import { scanSkills, readSkill } from './skill-registry.js';
import { createAdapters, validateAccountConfig } from './adapters.js';
import { checkedPath, PiRuntime } from './pi-runtime.js';
import { TaskManager, mediaType } from './task-manager.js';
import type { AgentSession, Bootstrap, CardId, Diagnostic, Preferences, Settings } from '../shared/types.js';
import type { ServerResponse } from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function createApp(options: { dataDirectory?: string; dev?: boolean } = {}) {
  const store = new Store(options.dataDirectory ?? path.join(root, '.data'), initialCards);
  const vault = new KeyVault(path.join(store.directory, 'credentials.dpapi'));
  store.state.settings.keyConfigured = Boolean(await vault.get());
  const adapters = createAdapters();
  const pi = new PiRuntime({ dataDirectory: store.directory, getSettings: () => store.state.settings, getSkills: () => store.state.skills, getApiKey: () => vault.get() });
  const clients = new Set<ServerResponse>();
  const broadcast = (name: string, data: unknown) => { const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`; for (const client of clients) if (!client.destroyed) client.write(message); };
  const manager = new TaskManager(store, adapters, pi, broadcast, () => vault.get());
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024, files: 1, fields: 4 } });
  const standardRoots = [path.join(os.homedir(), '.codex', 'skills'), path.join(os.homedir(), '.agents', 'skills')];
  const priorSkillIds = new Set(store.state.skills.map(s => s.id));
  store.state.skills = scanSkills([...standardRoots, ...store.state.settings.skillRoots], store.state.skills);
  for (const skill of store.state.skills) if (!priorSkillIds.has(skill.id) && skill.cardIds.length) skill.enabled = true;
  store.save();
  let diagnosticCache: { time: number; promise: Promise<Diagnostic[]> } | undefined;
  const diagnostics = () => {
    if (!diagnosticCache || Date.now() - diagnosticCache.time > 30_000) diagnosticCache = { time: Date.now(), promise: Promise.all(Object.values(adapters).map(async adapter => {
      const diagnostic = await adapter.inspect(store.state.settings);
      if (['onetake', 'hypit'].includes(diagnostic.id) && !store.state.skills.some(skill => skill.enabled && skill.cardIds.includes(diagnostic.id))) {
        diagnostic.available = false; diagnostic.issues.push('此创作 Skill 尚未在 Skills 库启用。'); diagnostic.fixes.push('在 Skills 库导入并启用对应的本地 SKILL.md。');
      }
      return diagnostic;
    })) };
    return diagnosticCache.promise;
  };
  const changed = () => { diagnosticCache = undefined; manager.changed(); };
  const requireIdle = () => { if (store.state.tasks.some(task => task.status === 'running')) throw new Error('任务执行中，请先停止任务或等待完成再修改运行配置。'); };
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.split(':')[0];
    if (!host || !['localhost', '127.0.0.1'].includes(host)) return reply.code(403).send({ error: '本地服务只接受回环地址访问' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) return reply.code(403).send({ error: '拒绝来自其他网页的本地服务请求' });
    if (request.url.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method) && request.headers['x-toolbox'] !== 'local') return reply.code(403).send({ error: '缺少本地操作标识' });
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cross-Origin-Resource-Policy', 'same-origin');
  });
  app.setErrorHandler(async (error, _request, reply) => { const message = error instanceof Error ? error.message : '操作失败'; return reply.code(400).send({ error: redact(message, [await vault.get() ?? '']) }); });
  app.get('/api/health', async () => ({ ok: true, engine: 'Pi SDK', version: '0.1.0' }));
  app.get('/api/bootstrap', async (): Promise<Bootstrap> => ({ cards: store.state.cards, workflows, diagnostics: await diagnostics(), skills: store.state.skills,
    tasks: store.state.tasks, sessions: store.state.sessions, settings: store.state.settings, preferences: store.state.preferences, assets: store.state.assets, runtime: await pi.inspect() }));
  app.get('/api/events', (request, reply) => {
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    clients.add(reply.raw); reply.raw.write('event: update\ndata: {}\n\n');
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    request.raw.on('close', () => { clients.delete(reply.raw); clearInterval(heartbeat); });
  });
  app.post<{ Body: { cardId: CardId; input: Record<string, unknown> } }>('/api/tasks', async request => {
    const { cardId, input } = request.body;
    const card = store.state.cards.find(c => c.id === cardId); if (!card || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('任务参数无效');
    const validation = validateFields(card.fields, input); if (validation.length) throw new Error(validation.join('；'));
    const adapterErrors = await adapters[cardId].validate(input, store.state.settings); if (adapterErrors.length) throw new Error(adapterErrors.join('；'));
    if (input.outputDirectory) input.outputDirectory = directory(input.outputDirectory);
    return manager.enqueueCard(cardId, input);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async request => manager.cancel(request.params.id));
  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async request => manager.retry(request.params.id));
  app.post<{ Params: { id: string }; Body: { choice?: number; confirmed?: boolean } }>('/api/tasks/:id/continue', async request => manager.continue(request.params.id, request.body));
  app.post('/api/assets/upload', async request => {
    const file = await request.file(); if (!file) throw new Error('请选择一个文件');
    const id = randomUUID(), name = path.basename(file.filename).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const folder = path.join(store.directory, 'assets', id); fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, name || 'upload');
    try { await pipeline(file.file, fs.createWriteStream(target)); if (file.file.truncated) throw new Error('文件超过 1 GB'); }
    catch (error) { if (fs.existsSync(target)) fs.unlinkSync(target); throw error; }
    const asset = { id, name, path: target, mime: mediaType(target), size: fs.statSync(target).size, url: '/api/assets/' + id };
    store.state.assets.push(asset); manager.changed(); return asset;
  });
  app.post<{ Body: { kind: 'file' | 'files' | 'directory' } }>('/api/assets/select', async request => {
    if (!['file', 'files', 'directory'].includes(request.body.kind)) throw new Error('选择类型无效');
    if (process.platform !== 'win32') throw new Error('本地选择器目前仅支持 Windows，请使用上传或路径输入');
    const kind = request.body.kind;
    const script = kind === 'directory'
      ? "Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; if($dialog.ShowDialog() -eq 'OK'){ ConvertTo-Json -InputObject @($dialog.SelectedPath) -Compress } else { '[]' }"
      : `Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.OpenFileDialog; $dialog.Multiselect=$${kind === 'files' ? 'true' : 'false'}; if($dialog.ShowDialog() -eq 'OK'){ ConvertTo-Json -InputObject @($dialog.FileNames) -Compress } else { '[]' }`;
    const paths = await new Promise<string[]>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script], { windowsHide: true, shell: false });
      let output = ''; child.stdout.on('data', data => output += data); child.stderr.resume(); child.on('error', reject);
      child.on('close', code => { try { if (code !== 0) throw new Error('无法打开本地选择器'); resolve(JSON.parse(output.trim() || '[]')); } catch (error) { reject(error); } });
    });
    if (kind !== 'directory') for (const selected of paths) {
      const file = existingFile(selected), mime = mediaType(file);
      if (mime === 'text/plain' || store.state.assets.some(asset => asset.path === file)) continue;
      const id = randomUUID(); store.state.assets.push({ id, name: path.basename(file), path: file, mime, size: fs.statSync(file).size, url: '/api/assets/' + id });
    }
    if (paths.length) manager.changed();
    return { paths };
  });
  for (const type of ['assets', 'artifacts'] as const) app.get<{ Params: { id: string } }>(`/api/${type}/:id`, async (request, reply) => {
    const item = type === 'assets' ? store.state.assets.find(asset => asset.id === request.params.id) : store.state.tasks.flatMap(task => task.artifacts).find(artifact => artifact.id === request.params.id);
    if (!item) return reply.code(404).send({ error: '文件不存在' });
    const target = existingFile(item.path), size = fs.statSync(target).size;
    reply.header('Content-Type', item.mime).header('Accept-Ranges', 'bytes').header('Content-Security-Policy', "sandbox; default-src 'none'");
    const range = request.headers.range;
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/); if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || end < start) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(fs.createReadStream(target, { start, end }));
    }
    return reply.header('Content-Length', size).send(fs.createReadStream(target));
  });
  app.post<{ Params: { id: string } }>('/api/artifacts/:id/open', async request => {
    const file = store.state.tasks.flatMap(task => task.artifacts).find(artifact => artifact.id === request.params.id); if (!file) throw new Error('产物不存在');
    const target = existingFile(file.path);
    const child = process.platform === 'win32' ? spawn('explorer.exe', ['/select,', target], { windowsHide: true, detached: true, stdio: 'ignore' }) : spawn('xdg-open', [path.dirname(target)], { detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { child.on('spawn', () => resolve()); child.on('error', reject); }); child.unref(); return { ok: true };
  });
  app.post<{ Body: { title?: string; cwd?: string } }>('/api/sessions', async request => {
    const cwd = directory(request.body?.cwd || store.state.settings.workDirectory);
    const session: AgentSession = { id: randomUUID(), title: String(request.body?.title || '新会话').slice(0, 100), cwd, createdAt: new Date().toISOString(), messages: [] };
    store.state.sessions.unshift(session); manager.changed(); return session;
  });
  app.post<{ Params: { id: string }; Body: { text: string; files?: string[] } }>('/api/sessions/:id/messages', async request => {
    const session = store.state.sessions.find(s => s.id === request.params.id); if (!session) throw new Error('会话不存在');
    if (typeof request.body.text !== 'string' || !request.body.text.trim() || request.body.text.length > 32_000) throw new Error('消息须为 1–32000 个字符');
    const files: string[] = []; const selected = request.body.files ?? [];
    if (!Array.isArray(selected) || selected.length > 20) throw new Error('文件上下文最多 20 个');
    for (const value of selected) {
      const source = existingFile(value);
      if (/(^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.ssh|\.aws|\.codex|\.pi|auth\.json|credentials(?:\.[^\\/]*)?|[^\\/]*\.(?:pem|key))($|[\\/])/i.test(source)) throw new Error('禁止将凭据文件添加为模型上下文');
      const contextFolder = await checkedPath(path.join(session.cwd, 'context', randomUUID()), session.cwd, [session.cwd], [path.join(store.directory, 'pi'), path.join(store.directory, 'credentials.dpapi')]);
      fs.mkdirSync(contextFolder, { recursive: true });
      const target = path.join(contextFolder, path.basename(source)); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); files.push(target);
    }
    return manager.enqueueAgent(session, request.body.text, files);
  });
  app.post('/api/runtime/test', async () => {
    const cwd = store.state.settings.workDirectory; const name = `toolbox-connection-check-${randomUUID()}.txt`; const probe = path.join(cwd, name);
    fs.writeFileSync(probe, 'Toolmim 连接检查：Pi 的 read 工具已连接。\n', { flag: 'wx' });
    const session: AgentSession = { id: randomUUID(), title: '模型连接与工具检查', cwd, createdAt: new Date().toISOString(), messages: [] };
    store.state.sessions.unshift(session); return manager.enqueueAgent(session, `请使用 read 工具读取 ${name}，然后准确返回文件内容。`, [probe]);
  });
  app.post<{ Body: { path: string } }>('/api/skills/import', async request => {
    requireIdle(); if (typeof request.body.path !== 'string') throw new Error('Skill 路径无效'); const next = readSkill(request.body.path);
    const current = store.state.skills.find(skill => skill.id === next.id); if (!current) store.state.skills.push(next);
    await pi.invalidate(); changed(); return current ?? next;
  });
  app.post<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/skills/:id/toggle', async request => {
    requireIdle(); const skill = store.state.skills.find(s => s.id === request.params.id); if (!skill) throw new Error('Skill 不存在');
    if (typeof request.body.enabled !== 'boolean') throw new Error('启用状态无效');
    if (request.body.enabled && !fs.existsSync(skill.path)) throw new Error('Skill 文件已不存在'); skill.enabled = request.body.enabled;
    await pi.invalidate(); changed(); return skill;
  });
  app.post('/api/skills/rescan', async () => {
    requireIdle(); store.state.skills = scanSkills([...standardRoots, ...store.state.settings.skillRoots], store.state.skills);
    await pi.invalidate(); changed(); return store.state.skills;
  });
  app.put<{ Body: Partial<Settings> & { apiKey?: string; clearKey?: boolean } }>('/api/settings', async request => {
    requireIdle(); const input = request.body; if (!input || typeof input !== 'object') throw new Error('设置格式无效');
    const next = structuredClone(store.state.settings);
    for (const key of ['provider', 'modelId', 'baseUrl'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'string' || input[key]!.length > 2048) throw new Error('模型设置无效'); next[key] = input[key]!.trim(); }
    if (!next.provider || !next.modelId) throw new Error('Provider 和模型不能为空');
    if (next.baseUrl) { const url = new URL(next.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('端点须为无内嵌凭据、查询参数和片段的 HTTP(S) URL；密钥请使用 API Key 字段'); }
    if (input.allowCommands !== undefined) { if (typeof input.allowCommands !== 'boolean') throw new Error('命令权限格式无效'); next.allowCommands = input.allowCommands; }
    for (const key of ['workDirectory', 'outputDirectory'] as const) if (input[key] !== undefined) next[key] = directory(input[key]);
    if (input.skillRoots !== undefined) { if (!Array.isArray(input.skillRoots) || input.skillRoots.length > 20) throw new Error('Skills 路径无效'); next.skillRoots = input.skillRoots.map(directory); }
    if (input.executors !== undefined) {
      for (const key of Object.keys(next.executors) as (keyof Settings['executors'])[]) if (input.executors[key] !== undefined) {
        const value = input.executors[key]; if (typeof value !== 'string' || value.includes('\0') || value.length > 4096) throw new Error('执行器设置无效');
        next.executors[key] = key.endsWith('Root') && value ? directory(value) : value;
      }
    }
    if (input.apiKey) await vault.set(input.apiKey); else if (input.clearKey === true) vault.clear();
    next.keyConfigured = Boolean(await vault.get()); store.state.settings = next; await pi.invalidate(); changed(); return next;
  });
  app.put<{ Body: Partial<Preferences> }>('/api/preferences', async request => {
    const value = request.body;
    for (const key of ['favorites', 'order', 'recent'] as const) if (value[key]) {
      if (!Array.isArray(value[key]) || value[key]!.some(id => !initialCards.some(c => c.id === id))) throw new Error('工具偏好无效');
      store.state.preferences[key] = [...new Set(value[key])];
    }
    if (value.presets) {
      if (!Array.isArray(value.presets) || value.presets.length > 100 || value.presets.some(p => typeof p.name !== 'string' || typeof p.id !== 'string' || !initialCards.some(c => c.id === p.cardId) || !p.input || typeof p.input !== 'object' || Array.isArray(p.input))) throw new Error('预设格式无效');
      for (const preset of value.presets) if (preset.cardId === 'social') { const errors = validateAccountConfig(preset.input); if (errors.length) throw new Error(errors.join('；')); }
      store.state.preferences.presets = value.presets;
    }
    if (value.lastInputs) {
      if (typeof value.lastInputs !== 'object' || Array.isArray(value.lastInputs) || Object.keys(value.lastInputs).some(id => !initialCards.some(c => c.id === id))) throw new Error('上次参数格式无效');
      if (value.lastInputs.social) { const errors = validateAccountConfig(value.lastInputs.social); if (errors.length) throw new Error(errors.join('；')); }
      store.state.preferences.lastInputs = value.lastInputs;
    }
    manager.changed(); return store.state.preferences;
  });
  app.put<{ Params: { id: CardId }; Body: Partial<import('../shared/types.js').ToolCard> }>('/api/cards/:id', async request => {
    const current = store.state.cards.find(c => c.id === request.params.id); if (!current) throw new Error('卡片不存在');
    const card = structuredClone(current);
    const input = request.body;
    for (const key of ['title', 'description', 'icon', 'category'] as const) if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !input[key]!.trim() || input[key]!.length > 500) throw new Error('卡片文本格式无效'); card[key] = input[key]!;
    }
    if (input.fields) {
      const types = ['text', 'textarea', 'number', 'select', 'file', 'files', 'directory', 'multiselect'];
      if (!Array.isArray(input.fields) || input.fields.length > 30 || input.fields.some(f => !/^[A-Za-z][A-Za-z0-9_]*$/.test(f.key) || typeof f.label !== 'string' || !types.includes(f.type) || (f.when && (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.when.key) || typeof f.when.value !== 'string'))) || new Set(input.fields.map(f => f.key)).size !== input.fields.length) throw new Error('字段 Schema 格式无效');
      const defaults = Object.fromEntries(input.fields.filter(f => f.default !== undefined).map(f => [f.key, f.default]));
      const errors = validateFields(input.fields.map(f => ({ ...f, required: false })), defaults); if (errors.length) throw new Error(errors.join('；'));
      card.fields = input.fields;
    }
    store.state.cards[store.state.cards.indexOf(current)] = card; manager.changed(); return card;
  });
  app.addHook('preClose', async () => { for (const client of clients) client.end(); await manager.close(); });
  app.addHook('onClose', async () => { await pi.invalidate(); });
  if (options.dev) {
    const { createServer } = await import('vite'); const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    app.all('/*', async (request, reply) => { if (request.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' }); reply.hijack(); vite.middlewares(request.raw, reply.raw, () => { reply.raw.statusCode = 404; reply.raw.end('Not found'); }); });
    app.addHook('onClose', async () => { await vite.close(); });
  } else if (fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    await app.register(staticFiles, { root: path.join(root, 'dist'), wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  }
  return { app, store, manager, pi };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirectory = process.env.TOOLMIM_DATA || process.env.TUMING_DATA;
  const { app } = await createApp({ dev: process.argv.includes('--dev'), dataDirectory: dataDirectory ? path.resolve(dataDirectory) : undefined });
  const port = Number(process.env.TOOLMIM_PORT || process.env.TUMING_PORT || 4317); await app.listen({ host: '127.0.0.1', port });
  console.log(`Toolmim · 图明 AI 全能箱已启动：http://127.0.0.1:${port}`);
  const close = async () => { await app.close(); process.exit(0); }; process.once('SIGINT', close); process.once('SIGTERM', close);
}
