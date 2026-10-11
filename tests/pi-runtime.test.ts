import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkedPath, PiRuntime } from '../server/pi-runtime.js';
import type { AgentSession, RuntimeEvent, Settings, Skill } from '../shared/types.js';

const config = (cwd: string): Settings => ({
  provider: 'fixture', modelId: 'fixture-model', baseUrl: '', keyConfigured: false, allowCommands: false,
  workDirectory: cwd, outputDirectory: cwd, skillRoots: [],
  executors: { onetakeRoot: '', hypitRoot: '', socialRoot: '', montageRoot: '', python: 'python', ffmpeg: 'ffmpeg' },
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tuming-pi-test-'));
  const data = join(directory, 'state'); const cwd = join(data, 'workspace');
  await mkdir(data); await mkdir(cwd);
  await writeFile(join(cwd, 'probe.txt'), '真实文件内容 42');
  const settings = config(cwd);
  const session: AgentSession = { id: 'app-session', title: 'test', cwd, createdAt: new Date().toISOString(), messages: [] };
  return { directory, cwd, data, settings, session };
}

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse, payload: any) => void) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    handler(request, response, JSON.parse(Buffer.concat(chunks).toString()));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, close: async () => {
    server.closeAllConnections(); await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  } };
}

function stream(response: ServerResponse, deltas: Record<string, unknown>[], finish: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const delta of deltas) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
  response.end();
}

test('Pi inspection uses the installed SDK and blocks a run without project credentials', async () => {
  const f = await fixture();
  const runtime = new PiRuntime({ dataDirectory: f.data, getSettings: () => f.settings, getSkills: () => [], getApiKey: async () => undefined });
  try {
    const diagnostic = await runtime.inspect();
    assert.equal(diagnostic.version, '1.1.0');
    assert.ok(diagnostic.models.some(model => model.provider === 'openai'));
    assert.equal(diagnostic.connected, false);
    await assert.rejects(runtime.run(f.session, '读取文件', { signal: new AbortController().signal, onEvent: () => {} }), /API Key/);
  } finally { await runtime.invalidate(); await rm(f.directory, { recursive: true, force: true }); }
});

test('workspace boundary rejects traversal, credentials, protected storage and escaping junctions', async () => {
  const f = await fixture();
  const protectedStorage = join(f.data, 'private'); await mkdir(protectedStorage);
  try {
    assert.equal(await checkedPath('probe.txt', f.cwd, [f.cwd], [protectedStorage]), join(f.cwd, 'probe.txt'));
    assert.equal(await checkedPath('new/future.txt', f.cwd, [f.cwd], [protectedStorage]), join(f.cwd, 'new', 'future.txt'));
    await assert.rejects(checkedPath('../outside.txt', f.cwd, [f.cwd], [protectedStorage]), /路径超出/);
    await assert.rejects(checkedPath('.env', f.cwd, [f.cwd], [protectedStorage]), /凭据/);
    await assert.rejects(checkedPath(protectedStorage, f.directory, [f.directory], [protectedStorage]), /路径超出/);
    await symlink(protectedStorage, join(f.cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(checkedPath('escape/future.txt', f.cwd, [f.cwd], []), /路径超出/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('real Pi SDK streams read/write tools, discovers explicit skills and restores JSONL context (fixture model)', async () => {
  const f = await fixture();
  const events: RuntimeEvent[] = []; const requests: any[] = [];
  const skillDirectory = join(f.directory, '.codex', 'skills', 'fixture-skill'); await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Fixture skill discovered through Pi resource loading\n---\nRead the probe file.');
  const skill: Skill = { id: 'fixture', name: 'fixture-skill', description: '', path: join(skillDirectory, 'SKILL.md'), source: 'test', enabled: true, issues: [], cardIds: [] };
  const server = await endpoint((_request, response, payload) => {
    requests.push(payload);
    if (requests.length === 1) stream(response, [{ role: 'assistant', tool_calls: [{ index: 0, id: 'read-call', type: 'function', function: { name: 'read', arguments: '{"path":"probe.txt"}' } }] }], 'tool_calls');
    else if (requests.length === 2) stream(response, [{ role: 'assistant', tool_calls: [{ index: 0, id: 'write-call', type: 'function', function: { name: 'write', arguments: '{"path":"result.txt","content":"42"}' } }] }], 'tool_calls');
    else stream(response, [{ role: 'assistant', content: '已读取：' }, { content: '42' }], 'stop');
  });
  f.settings.baseUrl = server.baseUrl; f.settings.keyConfigured = true;
  const runtime = new PiRuntime({ dataDirectory: f.data, getSettings: () => f.settings, getSkills: () => [skill], getApiKey: async () => 'fixture-only-key' });
  try {
    const result = await runtime.run(f.session, '请读取 probe.txt', { signal: new AbortController().signal, onEvent: event => events.push(event) });
    assert.equal(result.text, '已读取：42');
    assert.ok(events.some(event => event.type === 'text_delta'));
    assert.ok(events.some(event => event.type === 'tool_end' && event.tool === 'read' && event.text?.includes('真实文件内容 42')));
    assert.equal(await readFile(join(f.cwd, 'result.txt'), 'utf8'), '42');
    assert.ok(JSON.stringify(requests[0]).includes('fixture-skill'));
    assert.ok(!requests[0].tools.some((tool: any) => tool.function.name === 'bash' || tool.function.name === 'run_command'));
    assert.ok((await readFile(result.sessionFile, 'utf8')).includes('真实文件内容 42'));
    await runtime.invalidate();
    await runtime.run(f.session, '继续对话', { signal: new AbortController().signal, onEvent: () => {} });
    assert.ok(requests.at(-1).messages.some((message: any) => message.role === 'tool' && message.content.includes('真实文件内容 42')));
    assert.equal(f.session.sessionFile, result.sessionFile);
  } finally { await runtime.invalidate(); await server.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('opt-in command tool executes a real child process and cancellation cleans up the process', async () => {
  const f = await fixture(); const controller = new AbortController(); let pid = 0;
  const server = await endpoint((_request, response) => {
    const args = JSON.stringify({ command: process.execPath, args: ['-e', "console.log('tool-pid:' + process.pid); setInterval(() => {}, 1000)"] });
    stream(response, [{ role: 'assistant', tool_calls: [{ index: 0, id: 'command-call', type: 'function', function: { name: 'run_command', arguments: args } }] }], 'tool_calls');
  });
  f.settings.baseUrl = server.baseUrl; f.settings.keyConfigured = true; f.settings.allowCommands = true;
  const runtime = new PiRuntime({ dataDirectory: f.data, getSettings: () => f.settings, getSkills: () => [], getApiKey: async () => 'fixture-only-key' });
  try {
    await assert.rejects(runtime.run(f.session, '运行程序', { signal: controller.signal, onEvent: event => {
      const match = event.type === 'tool_update' && event.text?.match(/tool-pid:(\d+)/);
      if (match) { pid = Number(match[1]); controller.abort(new Error('停止子进程')); }
    } }), /停止子进程/);
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally { await runtime.invalidate(); await server.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('Pi cancellation aborts an active model stream and releases the runtime for retry', async () => {
  const f = await fixture(); let requested: (() => void) | undefined;
  const firstRequest = new Promise<void>(done => { requested = done; });
  let count = 0;
  const server = await endpoint((_request, response) => {
    if (++count === 1) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders(); requested!(); }
    else stream(response, [{ role: 'assistant', content: '重试成功' }], 'stop');
  });
  f.settings.baseUrl = server.baseUrl; f.settings.keyConfigured = true;
  const runtime = new PiRuntime({ dataDirectory: f.data, getSettings: () => f.settings, getSkills: () => [], getApiKey: async () => 'fixture-only-key' });
  try {
    const controller = new AbortController();
    const running = runtime.run(f.session, '等待', { signal: controller.signal, onEvent: () => {} });
    await firstRequest; controller.abort(new Error('测试取消'));
    await assert.rejects(running, /测试取消/);
    assert.ok(f.session.sessionFile);
    const result = await runtime.run(f.session, '重试', { signal: new AbortController().signal, onEvent: () => {} });
    assert.equal(result.text, '重试成功');
  } finally { await runtime.invalidate(); await server.close(); await rm(f.directory, { recursive: true, force: true }); }
});
