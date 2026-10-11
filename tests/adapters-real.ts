import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAdapters } from '../server/adapters.ts';
import { runProcess } from '../server/runner.ts';
import type { Settings } from '../shared/types.ts';

// 显式的本机真实连通测试，默认 npm test 不执行耗时渲染。
const directory = path.resolve('data', `adapter-real-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: true });
const settings: Settings = {
  provider: 'openai', modelId: 'gpt-4.1-mini', baseUrl: '', keyConfigured: false, allowCommands: false,
  workDirectory: directory, outputDirectory: directory, skillRoots: [],
  executors: { onetakeRoot: '', hypitRoot: '', socialRoot: '', montageRoot: process.env.TOOLMIM_TEST_MONTAGE_ROOT || '', python: process.env.TOOLMIM_TEST_PYTHON || 'python', ffmpeg: 'ffmpeg' },
};
const adapters = createAdapters();
if (!process.argv.includes('--montage')) {
  const diagnostics = await Promise.all(Object.values(adapters).map(adapter => adapter.inspect(settings)));
  await writeFile(path.join(directory, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify({ directory, diagnostics }, null, 2));
} else {
  const sourceDirectory = process.env.TOOLMIM_TEST_VIDEOS || process.env.TUMING_TEST_VIDEOS;
  assert.ok(sourceDirectory, '请设置 TOOLMIM_TEST_VIDEOS 为自有测试素材目录');
  const videos = (await readdir(sourceDirectory)).filter(name => /\.mp4$/i.test(name)).map(name => path.join(sourceDirectory, name));
  assert.ok(videos.length >= 2, '真实混剪测试需要至少两个本地视频');
  const inputHashes = await Promise.all(videos.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')]));
  const bgm = path.join(directory, '测试节拍.wav');
  await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc=0.10*sin(2*PI*220*t)+if(lt(mod(t\\,0.5)\\,0.035)\\,0.55*sin(2*PI*1200*t)\\,0):s=44100:d=8", '-c:a', 'pcm_s16le', bgm], { cwd: directory });
  const input = { mode: 'lite', videos, bgm, ratio: '16:9', count: 1 };
  const stages: string[] = [], logs: string[] = [];
  const diagnostic = await adapters.montage.inspect(settings);
  assert.equal(diagnostic.available, true, diagnostic.issues.join('\n'));
  const result = await adapters.montage.execute(input, {
    taskId: 'real-montage', input, settings, skills: [], workingDirectory: directory, outputDirectory: path.join(directory, 'outputs'),
    signal: new AbortController().signal,
    onStage: stage => { stages.push(stage); console.log(stage); }, onLog: message => { logs.push(message); process.stdout.write(message); },
    runPi: async () => { throw new Error('确定性本地混剪不调用模型'); },
  });
  const outputVideos = result.files?.filter(file => /result\.mp4$/.test(file)) ?? [];
  assert.equal(outputVideos.length, 1);
  assert.ok((await stat(outputVideos[0])).size > 1000);
  for (const [file, hash] of inputHashes) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, '原始素材保持只读');
  const proof = { diagnostic, input: { ...input, source: sourceDirectory }, result, stages, checks: ['真实独立官方 BMTS Lite worker.run', '上游音视频/时长/分辨率检查', 'MP4 完整解码', '原始素材 SHA256 未改变'] };
  await writeFile(path.join(directory, 'verification.json'), JSON.stringify(proof, null, 2));
  await writeFile(path.join(directory, 'progress.log'), logs.join(''));
  console.log(`\nREAL_MONTAGE_PASS ${directory}`);
}
