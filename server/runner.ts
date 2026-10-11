import { spawn } from 'node:child_process';

export async function runProcess(command: string, args: string[], options: { cwd?: string; signal?: AbortSignal; onLog?: (message: string) => void; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string }> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', spawnError: Error | undefined;
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    options.signal?.addEventListener('abort', kill, { once: true });
    if (options.signal?.aborted) kill();
    child.stdout.on('data', chunk => { const text = chunk.toString(); stdout = (stdout + text).slice(-4_000_000); options.onLog?.(text); });
    child.stderr.on('data', chunk => { const text = chunk.toString(); stderr = (stderr + text).slice(-4_000_000); options.onLog?.(text); });
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      options.signal?.removeEventListener('abort', kill);
      if (options.signal?.aborted) reject(new Error('执行已取消'));
      else if (spawnError) reject(new Error(`无法运行 ${command}: ${spawnError.message}`));
      else if (code !== 0) reject(new Error(`进程退出码 ${code}: ${stderr.slice(-4000) || stdout.slice(-4000)}`));
      else resolve({ stdout, stderr });
    });
  });
}
