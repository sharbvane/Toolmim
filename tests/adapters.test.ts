import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createAdapters, validateAccountConfig } from '../server/adapters.ts';
import { runProcess } from '../server/runner.ts';
import type { RunContext, Settings } from '../shared/types.ts';

const settings = (root: string): Settings => ({
  provider: 'openai', modelId: 'test', baseUrl: '', keyConfigured: false, allowCommands: false,
  skillRoots: [], workDirectory: root, outputDirectory: root,
  executors: { onetakeRoot: root, hypitRoot: root, socialRoot: root, montageRoot: root, python: 'python', ffmpeg: 'ffmpeg' },
});

test('真实参数契约拒绝缺素材、无效概念、缺 B 站分区和不支持排期的平台', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tuming-contract-'));
  try {
    const file = path.join(root, 'fixture.mp4'); await writeFile(file, 'fixture');
    const adapters = createAdapters(), config = settings(root);
    assert.ok((await adapters.montage.validate({ videos: [file, file], bgm: file, theme: 'x', duration: 8, ratio: '16:9', count: 1 }, config)).some(error => error.includes('两个不同')));
    assert.ok((await adapters.onetake.validate({ productName: 'x', description: 'x', duration: 15, style: 'paper', choice: true }, config)).some(error => error.includes('索引')));
    const base = { video: file, title: 'x', description: 'x', account: 'creator' };
    assert.ok((await adapters.social.validate({ ...base, platforms: ['bilibili'] }, config)).some(error => error.includes('tid')));
    assert.ok((await adapters.social.validate({ ...base, platforms: ['youtube'], schedule: '2099-01-01 10:00' }, config)).some(error => error.includes('不支持定时')));
    assert.ok((await adapters.social.validate({ ...base, platforms: ['douyin'], account: '../../cookie' }, config)).some(error => error.includes('账号名')));
    assert.ok((await adapters.social.validate({ ...base, platforms: ['douyin'], accounts: '{"cookies":[{"name":"token"}]}' }, config)).some(error => error.includes('Cookie')));
    assert.ok((await adapters.social.validate({ ...base, platforms: ['douyin'], accounts: '{"youtube":123}' }, config)).some(error => error.includes('账号名')));
    assert.ok((await adapters.social.validate({ ...base, platforms: ['douyin'], schedule: '2099-02-30 10:00' }, config)).some(error => error.includes('排期')));
    assert.deepEqual(await adapters.social.validate({ ...base, platforms: ['douyin'], schedule: '2099-01-01 10:00' }, config), []);
    assert.ok(validateAccountConfig({ account: { cookies: [] } }).length);
    assert.ok(validateAccountConfig({ accounts: { cookies: [] } }).length);
    assert.ok(validateAccountConfig({ accounts: '{"cookies":[]}' }).length);
    assert.deepEqual(validateAccountConfig({ account: '', accounts: '{"douyin":"test_account"}' }), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('social CLI 测试替身：预览和字符串确认不触发上传，bool true 才调用上传', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tuming-social-gate-'));
  try {
    const video = path.join(root, 'fixture.mp4'), output = path.join(root, 'outputs'); await mkdir(output);
    await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=5:duration=0.4', '-an', '-c:v', 'libx264', video], { cwd: root });
    await writeFile(path.join(root, 'sau_cli.py'), `import pathlib,sys\na=sys.argv[1:]\nif '--help' in a: print('douyin kuaishou xiaohongshu bilibili tencent youtube baijiahao')\nelif 'check' in a: print('valid')\nelif 'upload-video' in a: pathlib.Path('uploads.txt').open('a').write(a[0]+'\\n'); print('upload fixture success')\nelse: raise SystemExit(1)\n`);
    const config = settings(root), adapters = createAdapters();
    const input = { video, platforms: ['douyin'], account: 'test_fixture', title: 'fixture', description: '', tags: '' };
    const context: RunContext = { taskId: 'fixture', workingDirectory: root, outputDirectory: output, signal: new AbortController().signal, settings: config, skills: [], input, onLog: () => {}, onStage: () => {}, runPi: async () => { throw new Error('social 不调用 Pi'); } };
    const first = await adapters.social.execute(input, context);
    assert.equal(first.waiting?.stage, '等待明确确认发布');
    assert.equal((first.waiting?.data as { canConfirm: boolean }).canConfirm, true);
    const stringConfirmation = await adapters.social.execute({ ...input, confirmed: 'true' }, context);
    assert.ok(stringConfirmation.waiting);
    await assert.rejects(readFile(path.join(root, 'uploads.txt')));
    const confirmed = await adapters.social.execute({ ...input, confirmed: true }, context);
    assert.equal(confirmed.waiting, undefined);
    assert.equal((await readFile(path.join(root, 'uploads.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'douyin\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
