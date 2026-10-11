import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { initialCards, validateFields } from '../server/cards.js';
import { readSkill, scanSkills } from '../server/skill-registry.js';
import { inside, redact, KeyVault } from '../server/security.js';
import { runProcess } from '../server/runner.js';
import { TaskManager } from '../server/task-manager.js';
import { PiRuntime } from '../server/pi-runtime.js';
import type { Adapter, CardId } from '../shared/types.js';

test('Schema validates required files, unsupported options and numeric bounds', () => {
  const fields = initialCards.find(c => c.id === 'montage')!.fields;
  assert.ok(validateFields(fields, { mode: 'professional', videos: [], bgm: 'music', theme: 'test', duration: -1, ratio: '3:2' }).length >= 3);
  assert.deepEqual(validateFields(fields, { mode: 'lite', videos: ['a.mp4', 'b.mp4'], bgm: 'a.wav', duration: '', ratio: '16:9', count: 1 }), []);
  assert.ok(validateFields(fields, { mode: 'professional', videos: ['a.mp4', 'b.mp4'], bgm: 'a.wav', theme: '', duration: 10, ratio: '16:9' }).some(message => message.includes('参考视频')));
});
test('Skills scan real metadata and preserve disabled state', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tuming-skill-'));
  try {
    fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: sample\ndescription: >\n  first line\n  second line\n---\n# sample');
    const skill = readSkill(folder); assert.equal(skill.description, 'first line second line'); assert.equal(skill.enabled, false);
    assert.equal(scanSkills([folder], [{ ...skill, enabled: true }])[0].enabled, true);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('Store records restart interruption instead of reporting success', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tuming-store-'));
  try {
    const store = new Store(folder, initialCards);
    store.state.tasks.push({ id: 'fixture', kind: 'agent', input: {}, title: 'test', workingDirectory: folder, status: 'running', stage: 'working', logs: [], artifacts: [], createdAt: new Date().toISOString() });
    store.save(); const reopened = new Store(folder, initialCards); assert.equal(reopened.state.tasks[0].status, 'interrupted');
    fs.writeFileSync(reopened.file, '{broken'); assert.throws(() => new Store(folder, initialCards)); assert.equal(fs.readFileSync(reopened.file, 'utf8'), '{broken');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('Path boundaries and credential logs reject sibling escape and hide secrets', () => {
  assert.equal(inside(path.resolve('safe'), path.resolve('safe', 'file')), true);
  assert.equal(inside(path.resolve('safe'), path.resolve('safe-other', 'file')), false);
  assert.equal(redact('Bearer private-token apiKey=private token=1234', ['private']), 'Bearer [已隐藏] apiKey=[已隐藏]');
});
test('Runner preserves literal arguments and really cancels a subprocess', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'literal;$(value)']);
  assert.equal(result.stdout, 'literal;$(value)');
  const controller = new AbortController();
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => signalStarted = resolve);
  const running = runProcess(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { signal: controller.signal, onLog: () => signalStarted() });
  await started; controller.abort();
  await assert.rejects(running, /取消/);
});
test('Task queue writes real outputs, waits for confirmation, cancels and retries', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tuming-tasks-'));
  const store = new Store(folder, initialCards); let calls = 0;
  const adapter: Adapter = {
    id: 'social', inspect: async () => ({ id: 'social', available: true, installed: true, issues: [], fixes: [], capabilities: {}, source: 'test-only', verified: [] }),
    validate: async () => [], execute: async (input, ctx) => {
      calls++;
      if (input.slow) { await runProcess(process.execPath, ['-e', 'console.log("started");setInterval(()=>{},1000)'], { signal: ctx.signal, onLog: ctx.onLog }); }
      if (!input.confirmed) return { waiting: { stage: '等待确认', data: { title: '发布预览 fixture' } } };
      const file = path.join(ctx.outputDirectory, 'result.txt'); fs.writeFileSync(file, 'real file'); return { files: [file] };
    }
  };
  const adapters = Object.fromEntries(['onetake', 'hypit', 'social', 'montage'].map(id => [id, { ...adapter, id }])) as Record<CardId, Adapter>;
  const pi = new PiRuntime({ dataDirectory: folder, getSettings: () => store.state.settings, getSkills: () => [], getApiKey: async () => undefined });
  const manager = new TaskManager(store, adapters, pi, () => {}, async () => undefined);
  try {
    assert.throws(() => manager.enqueueCard('social', { confirmed: true }), /确认/);
    const task = manager.enqueueCard('social', {}); await manager.idle(); assert.equal(task.status, 'waiting_user'); assert.equal(calls, 1);
    assert.throws(() => manager.continue(task.id, {}), /明确确认/);
    manager.continue(task.id, { confirmed: true }); await manager.idle(); assert.equal(task.status, 'completed'); assert.equal(fs.readFileSync(task.artifacts[0].path, 'utf8'), 'real file');
    assert.throws(() => manager.retry(task.id), /只有/);
    const slow = manager.enqueueCard('social', { slow: true });
    while (!slow.logs.length) await new Promise(resolve => setTimeout(resolve, 20));
    manager.cancel(slow.id); await manager.idle(); assert.equal(slow.status, 'cancelled');
    slow.input.slow = false; const retry = manager.retry(slow.id); await manager.idle(); assert.equal(retry.status, 'waiting_user'); assert.equal(retry.retryOf, slow.id); assert.equal(retry.input.confirmed, undefined);
  } finally { await manager.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('Project API key is DPAPI encrypted and is never stored as plaintext', { skip: process.platform !== 'win32' }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tuming-key-'));
  try {
    const file = path.join(folder, 'credentials.dpapi'), vault = new KeyVault(file); await vault.set('fixture-key-value');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('fixture-key-value')); assert.equal(await new KeyVault(file).get(), 'fixture-key-value'); vault.clear(); assert.equal(await vault.get(), undefined);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
