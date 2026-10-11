import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createApp } from '../server/index.js';

const local = { host: '127.0.0.1:4317', 'x-toolbox': 'local' };

test('local API integration: request boundary, validation, vault, assets, no-key Agent and Skill management', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuming-api-test-'));
  const { app, store, manager } = await createApp({ dataDirectory: join(directory, 'data') });
  try {
    await t.test('rejects nonlocal Host, foreign Origin and missing operation marker', async () => {
      assert.equal((await app.inject({ url: '/api/health', headers: { host: 'attacker.example' } })).statusCode, 403);
      assert.equal((await app.inject({ url: '/api/health', headers: { host: local.host, origin: 'https://attacker.example' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/sessions', headers: { host: local.host }, payload: {} })).statusCode, 403);
      assert.equal((await app.inject({ url: '/api/health', headers: local })).statusCode, 200);
    });

    await t.test('rejects malformed task fields and unsupported settings values', async () => {
      const malformed = await app.inject({ method: 'POST', url: '/api/tasks', headers: local, payload: { cardId: 'montage', input: { videos: 'not-an-array' } } });
      assert.equal(malformed.statusCode, 400); assert.match(malformed.json().error, /视频素材|背景音乐/);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: local, payload: { allowCommands: 'true' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: local, payload: { baseUrl: 'https://user:secret@example.com' } })).statusCode, 400);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: local, payload: { baseUrl: 'https://example.com/v1?api_key=secret' } })).statusCode, 400);
      assert.equal(store.state.tasks.length, 0);
    });

    await t.test('project key is encrypted on disk and excluded from settings / bootstrap responses', async () => {
      const fakeKey = 'test-fixture-secret-key-31';
      const save = await app.inject({ method: 'PUT', url: '/api/settings', headers: local, payload: { apiKey: fakeKey } });
      assert.equal(save.statusCode, 200); assert.equal(save.json().keyConfigured, true); assert.ok(!save.body.includes(fakeKey));
      assert.ok(!(await readFile(join(store.directory, 'credentials.dpapi'), 'utf8')).includes(fakeKey));
      const bootstrap = await app.inject({ url: '/api/bootstrap', headers: local });
      assert.equal(bootstrap.statusCode, 200); assert.equal(bootstrap.json().settings.keyConfigured, true); assert.ok(!bootstrap.body.includes(fakeKey));
      const clear = await app.inject({ method: 'PUT', url: '/api/settings', headers: local, payload: { clearKey: true } });
      assert.equal(clear.json().keyConfigured, false);
    });
    await t.test('rejects Cookie objects before saving presets and last-used parameters', async () => {
      const cookie = { cookie: 'fixture-private-cookie' };
      const original = JSON.stringify(store.state.preferences);
      const preset = await app.inject({ method: 'PUT', url: '/api/preferences', headers: local, payload: { presets: [{ id: 'unsafe', cardId: 'social', name: 'unsafe', input: { accounts: JSON.stringify(cookie) } }] } });
      assert.equal(preset.statusCode, 400);
      const last = await app.inject({ method: 'PUT', url: '/api/preferences', headers: local, payload: { lastInputs: { social: { accounts: JSON.stringify(cookie) } } } });
      assert.equal(last.statusCode, 400); assert.equal(JSON.stringify(store.state.preferences), original);
      assert.ok(!(await readFile(store.file, 'utf8')).includes('fixture-private-cookie'));
    });

    await t.test('uploads a real file and serves byte ranges with safe content headers', async () => {
      const boundary = 'tuming-test-boundary'; const bytes = '0123456789';
      const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.txt"\r\nContent-Type: text/plain\r\n\r\n${bytes}\r\n--${boundary}--\r\n`);
      const upload = await app.inject({ method: 'POST', url: '/api/assets/upload', headers: { ...local, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
      assert.equal(upload.statusCode, 200); const asset = upload.json();
      assert.equal(await readFile(asset.path, 'utf8'), bytes);
      const partial = await app.inject({ url: asset.url, headers: { ...local, range: 'bytes=2-5' } });
      assert.equal(partial.statusCode, 206); assert.equal(partial.body, '2345'); assert.equal(partial.headers['content-range'], 'bytes 2-5/10');
      assert.equal(partial.headers['x-content-type-options'], 'nosniff'); assert.match(String(partial.headers['content-security-policy']), /sandbox/);
      const suffix = await app.inject({ url: asset.url, headers: { ...local, range: 'bytes=-3' } });
      assert.equal(suffix.body, '789');
      assert.equal((await app.inject({ url: asset.url, headers: { ...local, range: 'bytes=20-' } })).statusCode, 416);
    });

    await t.test('a real Agent task without credentials fails honestly and can be retried', async () => {
      const created = await app.inject({ method: 'POST', url: '/api/sessions', headers: local, payload: { title: '无密钥检查' } });
      assert.equal(created.statusCode, 200); const session = created.json();
      const started = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: local, payload: { text: '读取工作目录' } });
      assert.equal(started.statusCode, 200); await manager.idle();
      const task = manager.find(started.json().id);
      assert.equal(task.status, 'failed'); assert.match(task.error!, /API Key/); assert.equal(task.artifacts.length, 0);
      const retry = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/retry`, headers: local, payload: {} });
      assert.equal(retry.statusCode, 200); await manager.idle();
      assert.equal(manager.find(retry.json().id).status, 'failed');
    });

    await t.test('file contexts reject credentials and an escaping context junction before copying', async () => {
      const created = await app.inject({ method: 'POST', url: '/api/sessions', headers: local, payload: { title: '路径边界检查' } });
      const session = created.json();
      const credentials = join(directory, '.env'); await writeFile(credentials, 'test-owned-credential-fixture');
      const forbidden = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: local, payload: { text: '测试', files: [credentials] } });
      assert.equal(forbidden.statusCode, 400); assert.match(forbidden.json().error, /凭据/);
      const outside = join(directory, 'outside'); await mkdir(outside);
      const file = join(directory, 'ordinary.txt'); await writeFile(file, 'ordinary context');
      await symlink(outside, join(session.cwd, 'context'), process.platform === 'win32' ? 'junction' : 'dir');
      const escaping = await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, headers: local, payload: { text: '测试', files: [file] } });
      assert.equal(escaping.statusCode, 400); assert.match(escaping.json().error, /路径超出/);
      assert.deepEqual(await readdir(outside), []);
    });

    await t.test('connection probe preserves an existing user file and remains failed without a model key', async () => {
      const existing = join(store.state.settings.workDirectory, 'toolbox-connection-check.txt');
      await writeFile(existing, 'existing user file');
      const probe = await app.inject({ method: 'POST', url: '/api/runtime/test', headers: local, payload: {} });
      assert.equal(probe.statusCode, 200); await manager.idle();
      assert.equal(await readFile(existing, 'utf8'), 'existing user file');
      assert.equal(manager.find(probe.json().id).status, 'failed');
    });

    await t.test('imports, enables, disables and rescans a genuine local SKILL.md', async () => {
      const skillDirectory = join(directory, 'api-fixture-skill'); await mkdir(skillDirectory);
      await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: api-fixture-skill\ndescription: Local test skill\n---\nUse the read tool.');
      const imported = await app.inject({ method: 'POST', url: '/api/skills/import', headers: local, payload: { path: skillDirectory } });
      assert.equal(imported.statusCode, 200); const skill = imported.json(); assert.equal(skill.name, 'api-fixture-skill');
      assert.equal((await app.inject({ method: 'POST', url: `/api/skills/${skill.id}/toggle`, headers: local, payload: { enabled: true } })).json().enabled, true);
      const rescan = await app.inject({ method: 'POST', url: '/api/skills/rescan', headers: local, payload: {} });
      assert.ok(rescan.json().some((item: any) => item.id === skill.id && item.enabled));
      assert.equal((await app.inject({ method: 'POST', url: `/api/skills/${skill.id}/toggle`, headers: local, payload: { enabled: false } })).json().enabled, false);
    });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
